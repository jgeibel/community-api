import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import { Timestamp } from 'firebase-admin/firestore';
import interactionRoutes from './interactions';
import userRoutes from './users';
import { validateApiKey } from '../middleware/auth';
import { firestore } from '../firebase/admin';
import { addUtcDays, startOfDayInTimeZone } from '../utils/timezone';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST must be set (e.g. localhost:8080) before running pinned events tests');
}

const API_KEY = process.env.API_KEY ?? 'test-api-key';
process.env.API_KEY = API_KEY;

const app = express();
app.use(express.json());
app.use(validateApiKey);
app.use('/interactions', interactionRoutes);
app.use('/users', userRoutes);

const agent = request(app);

interface InteractionOptions {
  userId: string;
  eventId: string;
  active?: boolean;
}

async function createEvent(eventId: string, overrides: Partial<Record<string, unknown>> = {}): Promise<void> {
  const now = new Date();
  const baseStart = overrides.startTime instanceof Date
    ? overrides.startTime
    : now;
  const baseEnd = overrides.endTime instanceof Date
    ? overrides.endTime
    : addUtcDays(baseStart, 0);

  await firestore.collection('events').doc(eventId).set({
    title: overrides.title ?? `Event ${eventId}`,
    location: overrides.location ?? 'Community Center',
    tags: overrides.tags ?? ['community'],
    contentType: overrides.contentType ?? 'event',
    startTime: Timestamp.fromDate(baseStart),
    endTime: Timestamp.fromDate(baseEnd),
    source: overrides.source ?? 'calendar',
  });
}

function buildInteractionBody(options: InteractionOptions) {
  return {
    userId: options.userId,
    contentId: options.eventId,
    contentType: 'event',
    action: 'bookmarked',
    metadata: options.active === undefined ? undefined : { active: options.active },
    context: {
      position: 0,
      sessionId: `session-${randomUUID()}`,
      timeOfDay: 'morning',
      dayOfWeek: 'monday',
    },
    contentTags: [],
  };
}

async function clearPinnedData(userId: string): Promise<void> {
  const userDocRef = firestore.collection('userPinnedEvents').doc(userId);
  const entriesSnapshot = await userDocRef.collection('entries').get();
  const batch = firestore.batch();
  for (const doc of entriesSnapshot.docs) {
    batch.delete(doc.ref);
  }
  batch.delete(userDocRef);
  await batch.commit();
}

async function recordPin(options: InteractionOptions): Promise<void> {
  await agent
    .post('/interactions')
    .set('x-api-key', API_KEY)
    .send(buildInteractionBody(options))
    .expect(201);
}

test('Pinned events API', async t => {
  await t.test('mode=today returns events occurring today in LA timezone', async () => {
    const userId = `test-today-${randomUUID()}`;
    const eventId = `event-${randomUUID()}`;

    const laTodayStart = startOfDayInTimeZone(new Date(), 'America/Los_Angeles');
    const eventStart = new Date(laTodayStart);
    eventStart.setUTCHours(eventStart.getUTCHours() + 17); // 10 AM PT
    const eventEnd = new Date(eventStart);
    eventEnd.setHours(eventEnd.getHours() + 1);

    await createEvent(eventId, { startTime: eventStart, endTime: eventEnd });
    await clearPinnedData(userId);

    await recordPin({ userId, eventId, active: true });

    const response = await agent
      .get(`/users/${userId}/pinned-events`)
      .query({ mode: 'today' })
      .set('x-api-key', API_KEY)
      .set('x-user-id', userId)
      .expect(200);

    assert.equal(response.body.events.length, 1);
    const pinned = response.body.events[0];
    assert.equal(pinned.eventId, eventId);
    assert.equal(pinned.title, `Event ${eventId}`);
    assert.equal(pinned.location, 'Community Center');
    assert.equal(pinned.contentType, 'event');
    assert.ok(Array.isArray(pinned.tags));
    assert.ok(typeof pinned.startTime === 'string');
    assert.ok(typeof response.body.window.start === 'string');
    assert.ok(response.body.updatedAt === null || typeof response.body.updatedAt === 'string');

    await clearPinnedData(userId);
  });

  await t.test('unpin removes entry from results', async () => {
    const userId = `test-unpin-${randomUUID()}`;
    const eventId = `event-${randomUUID()}`;
    await createEvent(eventId);
    await clearPinnedData(userId);

    await recordPin({ userId, eventId, active: true });
    await recordPin({ userId, eventId, active: false });

    const response = await agent
      .get(`/users/${userId}/pinned-events`)
      .query({ mode: 'today' })
      .set('x-api-key', API_KEY)
      .set('x-user-id', userId)
      .expect(200);

    assert.deepStrictEqual(response.body.events, []);

    await clearPinnedData(userId);
  });

  await t.test('pagination works across multiple days', async () => {
    const userId = `test-pagination-${randomUUID()}`;
    const base = startOfDayInTimeZone(new Date(), 'America/Los_Angeles');
    const eventIds: string[] = [];

    await clearPinnedData(userId);

    for (let day = 0; day < 2; day++) {
      const eventId = `event-${randomUUID()}`;
      eventIds.push(eventId);
      const start = addUtcDays(base, day);
      start.setUTCHours(start.getUTCHours() + 18); // 11 AM PT equivalent
      const end = new Date(start);
      end.setHours(end.getHours() + 2);
      await createEvent(eventId, { startTime: start, endTime: end });
      await recordPin({ userId, eventId, active: true });
    }

    const firstPage = await agent
      .get(`/users/${userId}/pinned-events`)
      .query({
        start: base.toISOString(),
        end: addUtcDays(base, 3).toISOString(),
        pageSize: 1,
      })
      .set('x-api-key', API_KEY)
      .set('x-user-id', userId)
      .expect(200);

    assert.equal(firstPage.body.events.length, 1);
    assert.equal(firstPage.body.events[0].eventId, eventIds[0]);
    assert.ok(typeof firstPage.body.nextPageToken === 'string');

    const secondPage = await agent
      .get(`/users/${userId}/pinned-events`)
      .query({
        start: base.toISOString(),
        end: addUtcDays(base, 3).toISOString(),
        pageSize: 1,
        pageToken: firstPage.body.nextPageToken,
      })
      .set('x-api-key', API_KEY)
      .set('x-user-id', userId)
      .expect(200);

    assert.equal(secondPage.body.events.length, 1);
    assert.equal(secondPage.body.events[0].eventId, eventIds[1]);
    assert.equal(secondPage.body.nextPageToken, null);

    await clearPinnedData(userId);
  });

  await t.test('invalid query parameters yield 400', async () => {
    const userId = `test-invalid-${randomUUID()}`;

    const response = await agent
      .get(`/users/${userId}/pinned-events`)
      .query({ mode: 'tomorrow' })
      .set('x-api-key', API_KEY)
      .set('x-user-id', userId)
      .expect(400);

    assert.equal(response.body.error, 'mode must be "today" when provided');
  });
});
