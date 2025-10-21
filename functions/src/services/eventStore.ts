import { admin, firestore } from '../firebase/admin';
import { Timestamp } from 'firebase-admin/firestore';
import { CanonicalEvent } from '../models/event';

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
    rawSnapshot: Record<string, unknown>,
    existingSnapshot?: admin.firestore.DocumentSnapshot | null,
  ): Promise<PersistResult> {
    const docRef = this.db.collection('events').doc(event.id);
    const snapshot = existingSnapshot ?? (await docRef.get());
    const nextTags = normalizeTagSlugs(event.tags);
    event.tags = nextTags;

    const data = {
      title: event.title,
      description: event.description ?? null,
      seriesId: event.seriesId ?? null,
      seriesCategoryId: event.seriesCategoryId ?? null,
      seriesCategoryName: event.seriesCategoryName ?? null,
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
      rawSnapshot: pruneUndefinedDeep(rawSnapshot),
      classification: event.classification ?? null,
      vector: event.vector ?? null,
    };

    await docRef.set(pruneUndefinedDeep(data));

    return snapshot.exists ? 'updated' : 'created';
  }

  async updateEventSeriesInfo(
    eventId: string,
    seriesId: string | null,
    categoryId: string | null,
    categoryName: string | null,
  ): Promise<void> {
    const docRef = this.db.collection('events').doc(eventId);
    await docRef.set(pruneUndefinedDeep({
      seriesId: seriesId ?? null,
      seriesCategoryId: categoryId ?? null,
      seriesCategoryName: categoryName ?? null,
    }), { merge: true });
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

function pruneUndefinedDeep<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    const next = value
      .map(item => pruneUndefinedDeep(item))
      .filter(item => item !== undefined);
    return next as unknown as T;
  }

  if (typeof value === 'object') {
    if (value instanceof Date || value instanceof Timestamp) {
      return value;
    }

    const record: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (child === undefined) {
        continue;
      }
      const pruned = pruneUndefinedDeep(child);
      if (pruned !== undefined) {
        record[key] = pruned;
      }
    }
    return record as unknown as T;
  }

  return value;
}
