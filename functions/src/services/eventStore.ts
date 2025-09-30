import { admin, firestore } from '../firebase/admin';
import { Timestamp } from 'firebase-admin/firestore';
import { CanonicalEvent } from '../models/event';
import { GoogleCalendarRawEvent } from '../connectors/googleCalendarConnector';

export type PersistResult = 'created' | 'updated';

export class EventStore {
  private readonly db: admin.firestore.Firestore;

  constructor(db?: admin.firestore.Firestore) {
    this.db = db ?? firestore;
  }

  async getEvent(eventId: string): Promise<admin.firestore.DocumentSnapshot | null> {
    const docRef = this.db.collection('events').doc(eventId);
    const snapshot = await docRef.get();
    return snapshot.exists ? snapshot : null;
  }

  async touchEvent(docRef: admin.firestore.DocumentReference, updatedAt: string): Promise<void> {
    await docRef.update({
      lastFetchedAt: Timestamp.fromDate(new Date(updatedAt)),
      lastSeenAt: Timestamp.now(),
    });
  }

  async saveEvent(
    event: CanonicalEvent,
    raw: GoogleCalendarRawEvent,
    existingSnapshot?: admin.firestore.DocumentSnapshot | null,
  ): Promise<PersistResult> {
    const docRef = this.db.collection('events').doc(event.id);
    const snapshot = existingSnapshot ?? (await docRef.get());
    const nextTags = normalizeTagSlugs(event.tags);
    event.tags = nextTags;

    const data = {
      title: event.title,
      description: event.description ?? null,
      startTime: Timestamp.fromDate(new Date(event.startTime)),
      endTime: event.endTime ? Timestamp.fromDate(new Date(event.endTime)) : null,
      timeZone: event.timeZone ?? null,
      isAllDay: event.isAllDay ?? false,
      recurrence: event.recurrence ?? null,
      venue: event.venue ?? null,
      organizer: event.organizer ?? null,
      price: event.price ?? null,
      tags: event.tags,
      breadcrumbs: event.breadcrumbs,
      source: event.source,
      status: event.status ?? null,
      lastFetchedAt: Timestamp.fromDate(new Date(event.lastFetchedAt)),
      lastUpdatedAt: Timestamp.fromDate(new Date(event.lastUpdatedAt)),
      rawSnapshot: serializeRawEvent(raw),
      classification: event.classification ?? null,
      vector: event.vector ?? null,
    };

    await docRef.set(pruneUndefined(data));

    return snapshot.exists ? 'updated' : 'created';
  }
}

function normalizeTagSlugs(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }

  const unique = new Set<string>();
  for (const item of tags) {
    if (typeof item !== 'string') {
      continue;
    }
    const slug = item.trim().toLowerCase();
    if (slug.length === 0) {
      continue;
    }
    unique.add(slug);
  }
  return Array.from(unique);
}

function serializeRawEvent(raw: GoogleCalendarRawEvent) {
  const plain: Record<string, unknown> = {
    uid: raw.uid,
    summary: raw.summary,
    description: raw.description,
    start: raw.start ? raw.start.toISOString() : null,
    end: raw.end ? raw.end.toISOString() : null,
    isAllDay: raw.isAllDay ?? false,
    location: raw.location,
    url: raw.url,
    organizer: raw.organizer,
    status: raw.status,
    updated: raw.updated ?? null,
    timezone: raw.timezone,
    calendarId: raw.calendarId,
    fetchedUrl: raw.fetchedUrl,
  };

  return pruneUndefined(plain);
}

function pruneUndefined(value: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) {
      delete value[key];
    }
  }
  return value;
}
