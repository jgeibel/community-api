import { admin } from '../firebase/admin';
import { FeedSeriesCategory, FeedSeriesData, FeedSeriesHost, FeedSeriesOccurrence } from './feedTypes';

export function extractVector(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const filtered = value.filter(item => typeof item === 'number');
  if (filtered.length === 0) {
    return null;
  }
  return filtered as number[];
}

export function mapSeriesForFeed(
  doc: FirebaseFirestore.DocumentSnapshot | FirebaseFirestore.QueryDocumentSnapshot
): FeedSeriesData {
  const data = doc.data() ?? {};
  const upcomingOccurrences = Array.isArray(data.upcomingOccurrences)
    ? data.upcomingOccurrences
        .map(serializeSeriesOccurrence)
        .filter((occ): occ is FeedSeriesOccurrence => Boolean(occ))
    : [];
  const nextOccurrence =
    serializeSeriesOccurrence(data.nextOccurrence) ?? (upcomingOccurrences[0] ?? null);

  return {
    id: doc.id,
    title: typeof data.title === 'string' ? data.title : null,
    description: typeof data.description === 'string' ? data.description : null,
    summary: typeof data.summary === 'string' ? data.summary : null,
    host: sanitizeSeriesHost(data.host),
    tags: Array.isArray(data.tags)
      ? data.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
    source: data.source ?? null,
    category: sanitizeSeriesCategory(data),
    nextOccurrence,
    upcomingOccurrences,
  };
}

export function resolveSeriesCreatedAt(
  raw: Record<string, unknown>,
  series: FeedSeriesData
): Date {
  const created = extractFirestoreTimestamp(raw.createdAt);
  if (created) {
    return created.toDate();
  }
  const updated = extractFirestoreTimestamp(raw.updatedAt);
  if (updated) {
    return updated.toDate();
  }

  if (series.nextOccurrence?.startTime) {
    const parsed = new Date(series.nextOccurrence.startTime);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
}

export function sanitizeFeedStats(value: unknown): {
  views: number;
  likes: number;
  shares: number;
  bookmarks: number;
} {
  if (!value || typeof value !== 'object') {
    return { views: 0, likes: 0, shares: 0, bookmarks: 0 };
  }

  const stats = value as Record<string, unknown>;
  return {
    views: typeof stats.views === 'number' ? stats.views : 0,
    likes: typeof stats.likes === 'number' ? stats.likes : 0,
    shares: typeof stats.shares === 'number' ? stats.shares : 0,
    bookmarks: typeof stats.bookmarks === 'number' ? stats.bookmarks : 0,
  };
}

export function sanitizeSeriesHost(value: unknown): FeedSeriesHost {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const host = value as {
    id?: unknown;
    name?: unknown;
    organizer?: unknown;
    sourceIds?: unknown;
  };

  const sourceIds = Array.isArray(host.sourceIds)
    ? host.sourceIds.filter((item): item is string => typeof item === 'string')
    : [];

  return {
    id: typeof host.id === 'string' ? host.id : null,
    name: typeof host.name === 'string' ? host.name : null,
    organizer: typeof host.organizer === 'string' ? host.organizer : null,
    sourceIds,
  };
}

export function sanitizeSeriesCategory(value: Record<string, unknown>): FeedSeriesCategory {
  const id = typeof value.categoryId === 'string' ? value.categoryId : null;
  const name = typeof value.categoryName === 'string' ? value.categoryName : null;
  const slug = typeof value.categorySlug === 'string' ? value.categorySlug : null;

  return {
    id,
    name,
    slug,
  };
}

export function serializeSeriesOccurrence(value: unknown): FeedSeriesOccurrence | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const occurrence = value as {
    eventId?: unknown;
    title?: unknown;
    startTime?: unknown;
    endTime?: unknown;
    location?: unknown;
    tags?: unknown;
  };

  if (typeof occurrence.eventId !== 'string') {
    return null;
  }

  const startTs = extractFirestoreTimestamp(occurrence.startTime);
  if (!startTs) {
    return null;
  }

  const endTs = extractFirestoreTimestamp(occurrence.endTime);
  const tags = Array.isArray(occurrence.tags)
    ? occurrence.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];

  return {
    eventId: occurrence.eventId,
    title: typeof occurrence.title === 'string' ? occurrence.title : null,
    startTime: startTs.toDate().toISOString(),
    endTime: endTs ? endTs.toDate().toISOString() : null,
    location: typeof occurrence.location === 'string' ? occurrence.location : null,
    tags,
  };
}

export function extractFirestoreTimestamp(value: unknown): admin.firestore.Timestamp | null {
  if (!value) {
    return null;
  }

  if (value instanceof admin.firestore.Timestamp) {
    return value;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toDate?: () => Date }).toDate === 'function'
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    return admin.firestore.Timestamp.fromDate(date);
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return admin.firestore.Timestamp.fromDate(parsed);
    }
  }

  return null;
}
