import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { firestore } from '../firebase/admin';
import { addUtcDays, startOfDayInTimeZone } from '../utils/timezone';
import type { ContentType } from '../models/interaction';

const PINNED_EVENTS_COLLECTION = 'userPinnedEvents';
const ENTRIES_SUBCOLLECTION = 'entries';
const SERIES_SUBCOLLECTION = 'series';
const DEFAULT_TIME_ZONE = 'America/Los_Angeles';
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 30;

const db = firestore;

export interface PinnedEventEntry {
  eventId: string;
  seriesId?: string | null;
  seriesTitle?: string | null;
  hostName?: string | null;
  title: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  tags: string[];
  contentType: string | null;
  source?: string | null;
  pinnedAt: string | null;
  derived?: boolean;
}

export interface PinnedSeriesRecord {
  seriesId: string;
  title: string | null;
  hostName: string | null;
  tags: string[];
  pinnedAt: string | null;
}

export interface PinnedEventsQueryOptions {
  mode?: 'today';
  start?: Date;
  end?: Date;
  pageSize?: number;
  pageToken?: string;
}

export interface PinnedEventsQueryResult {
  events: PinnedEventEntry[];
  nextPageToken: string | null;
  window: {
    start: string;
    end: string;
  };
  updatedAt: string | null;
}

function isMockUser(userId: string): boolean {
  return userId.startsWith('mock-');
}

function parsePageToken(token?: string): number {
  if (!token) {
    return 0;
  }

  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    if (decoded.trim().startsWith('{')) {
      // Legacy payload format – reset to first page.
      return 0;
    }
    const offset = Number.parseInt(decoded, 10);
    if (Number.isNaN(offset) || offset < 0) {
      throw new Error('Invalid offset');
    }
    return offset;
  } catch (error) {
    console.warn('Failed to parse pinned events page token', error);
    throw new Error('Invalid page token');
  }
}

function encodePageToken(offset: number): string {
  return Buffer.from(String(offset)).toString('base64');
}

function extractTimestamp(value: unknown): Timestamp | null {
  if (!value) {
    return null;
  }

  if (value instanceof Timestamp) {
    return value;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toDate?: () => Date }).toDate === 'function'
  ) {
    const converted = (value as { toDate: () => Date }).toDate();
    return Timestamp.fromDate(converted);
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return Timestamp.fromDate(parsed);
    }
  }

  return null;
}

function timestampToIso(value: Timestamp | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value.toDate().toISOString();
}

function buildWindow(options: PinnedEventsQueryOptions): { start: Date; end: Date } {
  if (options.mode === 'today') {
    const now = new Date();
    const start = startOfDayInTimeZone(now, DEFAULT_TIME_ZONE);
    const end = addUtcDays(start, 1);
    return { start, end };
  }

  if (options.start || options.end) {
    const startInput = options.start ?? new Date();
    const endInput = options.end ?? addUtcDays(startInput, 30);
    if (endInput <= startInput) {
      throw new Error('end must be greater than start');
    }
    return { start: startInput, end: endInput };
  }

  const start = new Date();
  const end = addUtcDays(start, 30);
  return { start, end };
}

function sanitizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function sanitizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapPinnedEvent(doc: FirebaseFirestore.DocumentSnapshot): PinnedEventEntry {
  const data = doc.data() ?? {};

  return {
    eventId: typeof data.eventId === 'string' ? data.eventId : doc.id,
    seriesId: sanitizeString(data.seriesId),
    seriesTitle: sanitizeString(data.seriesTitle),
    hostName: sanitizeString(data.hostName),
    title: sanitizeString(data.title),
    startTime: timestampToIso(extractTimestamp(data.eventStartTime)),
    endTime: timestampToIso(extractTimestamp(data.eventEndTime)),
    location: sanitizeString(data.location),
    tags: sanitizeTags(data.tags),
    contentType: sanitizeString(data.contentType),
    source: sanitizeString(data.source),
    pinnedAt: timestampToIso(extractTimestamp(data.pinnedAt)),
    derived: false,
  };
}

function mapPinnedSeriesDoc(doc: FirebaseFirestore.DocumentSnapshot): PinnedSeriesRecord {
  const data = doc.data() ?? {};
  return {
    seriesId: doc.id,
    title: sanitizeString(data.title),
    hostName: sanitizeString(data.hostName),
    tags: sanitizeTags(data.tags),
    pinnedAt: timestampToIso(extractTimestamp(data.pinnedAt)),
  };
}

async function fetchEventMetadata(eventId: string): Promise<{
  title: string | null;
  location: string | null;
  tags: string[];
  startTime: Timestamp;
  endTime: Timestamp | null;
  contentType: string | null;
  source: string | null;
  seriesId: string | null;
  seriesTitle: string | null;
  hostName: string | null;
}> {
  const eventDoc = await db.collection('events').doc(eventId).get();
  if (!eventDoc.exists) {
    throw new Error(`Event ${eventId} not found`);
  }

  const data = eventDoc.data() ?? {};
  const startTs = extractTimestamp(data.startTime);
  if (!startTs) {
    throw new Error(`Event ${eventId} is missing startTime`);
  }

  const endTs = extractTimestamp(data.endTime);
  const seriesId = typeof data.seriesId === 'string' ? data.seriesId : null;
  const sourceId = sanitizeString(data.source?.sourceId);

  let seriesTitle: string | null = null;
  let hostName: string | null = null;

  if (seriesId) {
    try {
      const seriesDoc = await db.collection('eventSeries').doc(seriesId).get();
      if (seriesDoc.exists) {
        const seriesData = seriesDoc.data() ?? {};
        seriesTitle = sanitizeString(seriesData.title);
        hostName = sanitizeString(seriesData.host?.name);
      }
    } catch (error) {
      console.warn(`Failed to fetch series metadata for ${seriesId}`, error);
    }
  }

  return {
    title: sanitizeString(data.title),
    location: sanitizeString(data.location),
    tags: sanitizeTags(data.tags),
    startTime: startTs,
    endTime: endTs,
    contentType: sanitizeString(data.contentType),
    source: sourceId,
    seriesId,
    seriesTitle,
    hostName,
  };
}

async function fetchSeriesSummary(seriesId: string): Promise<{
  title: string | null;
  hostName: string | null;
  tags: string[];
  sourceId: string | null;
}> {
  const doc = await db.collection('eventSeries').doc(seriesId).get();
  if (!doc.exists) {
    throw new Error(`Series ${seriesId} not found`);
  }

  const data = doc.data() ?? {};
  const source = data.source ?? {};

  return {
    title: sanitizeString(data.title),
    hostName: sanitizeString(data.host?.name),
    tags: sanitizeTags(data.tags),
    sourceId: sanitizeString(source.sourceId),
  };
}

function clampPageSize(pageSize?: number): number {
  if (!pageSize || Number.isNaN(pageSize)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.max(Math.floor(pageSize), 1), MAX_PAGE_SIZE);
}

function toMillis(value: string | null | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return parsed;
}

function compareEntries(a: PinnedEventEntry, b: PinnedEventEntry): number {
  const aStart = toMillis(a.startTime, Number.MAX_SAFE_INTEGER);
  const bStart = toMillis(b.startTime, Number.MAX_SAFE_INTEGER);
  if (aStart !== bStart) {
    return aStart - bStart;
  }

  const aPinned = toMillis(a.pinnedAt, 0);
  const bPinned = toMillis(b.pinnedAt, 0);
  if (aPinned !== bPinned) {
    return bPinned - aPinned;
  }

  return a.eventId.localeCompare(b.eventId);
}

async function expandSeriesEntries(
  seriesIds: string[],
  summaries: Map<string, PinnedSeriesRecord>,
  windowStart: Date,
  windowEnd: Date,
  existingEventIds: Set<string>,
): Promise<PinnedEventEntry[]> {
  if (seriesIds.length === 0) {
    return [];
  }

  const refs = seriesIds.map(id => db.collection('eventSeries').doc(id));
  const snapshots = await db.getAll(...refs);

  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();
  const results: PinnedEventEntry[] = [];

  for (const snapshot of snapshots) {
    if (!snapshot.exists) {
      continue;
    }

    const data = snapshot.data() ?? {};
    const summary = summaries.get(snapshot.id);
    const occurrences = Array.isArray(data.upcomingOccurrences) ? data.upcomingOccurrences : [];
    const seriesTitle = sanitizeString(data.title) ?? summary?.title ?? null;
    const hostName = sanitizeString(data.host?.name) ?? summary?.hostName ?? null;
    const sourceId = sanitizeString(data.source?.sourceId);

    for (const occurrence of occurrences) {
      if (!occurrence?.eventId) {
        continue;
      }
      if (existingEventIds.has(occurrence.eventId)) {
        continue;
      }

      const startTs = extractTimestamp((occurrence as { startTime?: unknown }).startTime ?? null);
      if (!startTs) {
        continue;
      }
      const startMillis = startTs.toMillis();
      if (startMillis < startMs || startMillis >= endMs) {
        continue;
      }

      const endTs = extractTimestamp((occurrence as { endTime?: unknown }).endTime ?? null);

      let occurrenceTags: string[] = [];
      if (Array.isArray((occurrence as { tags?: unknown }).tags)) {
        occurrenceTags = sanitizeTags((occurrence as { tags?: unknown }).tags);
      }
      if (occurrenceTags.length === 0) {
        occurrenceTags = sanitizeTags(data.tags);
      }

      const occurrenceTitle = sanitizeString((occurrence as { title?: unknown }).title) ?? seriesTitle;
      const occurrenceLocation = sanitizeString((occurrence as { location?: unknown }).location);

      results.push({
        eventId: occurrence.eventId,
        seriesId: snapshot.id,
        seriesTitle,
        hostName,
        title: occurrenceTitle,
        startTime: timestampToIso(startTs),
        endTime: timestampToIso(endTs),
        location: occurrenceLocation,
        tags: occurrenceTags,
        contentType: 'event',
        source: sourceId,
        pinnedAt: summary?.pinnedAt ?? null,
        derived: true,
      });
    }
  }

  return results;
}

export async function setPinnedEventStatus(
  userId: string,
  eventId: string,
  pinned: boolean,
): Promise<void> {
  const trimmedUserId = userId.trim();
  const trimmedEventId = eventId.trim();

  if (!trimmedUserId) {
    throw new Error('userId is required');
  }

  if (!trimmedEventId) {
    throw new Error('eventId is required');
  }

  if (isMockUser(trimmedUserId)) {
    return;
  }

  const userDocRef = db.collection(PINNED_EVENTS_COLLECTION).doc(trimmedUserId);
  const entryRef = userDocRef.collection(ENTRIES_SUBCOLLECTION).doc(trimmedEventId);

  if (pinned) {
    try {
      const metadata = await fetchEventMetadata(trimmedEventId);
      await entryRef.set({
        eventId: trimmedEventId,
        title: metadata.title,
        location: metadata.location,
        tags: metadata.tags,
        eventStartTime: metadata.startTime,
        eventEndTime: metadata.endTime,
        contentType: metadata.contentType ?? 'event',
        source: metadata.source ?? null,
        seriesId: metadata.seriesId,
        seriesTitle: metadata.seriesTitle,
        hostName: metadata.hostName,
        pinnedAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.warn(`Failed to persist pinned event ${trimmedEventId}`, error);
      return;
    }
  } else {
    await entryRef.delete();
  }

  await userDocRef.set({
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export async function setPinnedSeriesStatus(
  userId: string,
  seriesId: string,
  pinned: boolean,
): Promise<void> {
  const trimmedUserId = userId.trim();
  const trimmedSeriesId = seriesId.trim();

  if (!trimmedUserId) {
    throw new Error('userId is required');
  }

  if (!trimmedSeriesId) {
    throw new Error('seriesId is required');
  }

  if (isMockUser(trimmedUserId)) {
    return;
  }

  const userDocRef = db.collection(PINNED_EVENTS_COLLECTION).doc(trimmedUserId);
  const entryRef = userDocRef.collection(SERIES_SUBCOLLECTION).doc(trimmedSeriesId);

  if (pinned) {
    try {
      const metadata = await fetchSeriesSummary(trimmedSeriesId);
      await entryRef.set({
        seriesId: trimmedSeriesId,
        title: metadata.title,
        hostName: metadata.hostName,
        tags: metadata.tags,
        source: metadata.sourceId,
        pinnedAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.warn(`Failed to persist pinned series ${trimmedSeriesId}`, error);
      return;
    }
  } else {
    await entryRef.delete();
  }

  await userDocRef.set({
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export async function applyPinToggle(
  userId: string,
  contentId: string,
  contentType: ContentType,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const activeField = metadata ? metadata['active'] : undefined;
  const activeValue = typeof activeField === 'boolean'
    ? activeField
    : true;

  if (contentType === 'event-series') {
    await setPinnedSeriesStatus(userId, contentId, activeValue);
  } else {
    await setPinnedEventStatus(userId, contentId, activeValue);
  }
}

export async function getPinnedEvents(
  userId: string,
  options: PinnedEventsQueryOptions = {},
): Promise<PinnedEventsQueryResult> {
  const trimmedUserId = userId.trim();
  if (!trimmedUserId) {
    throw new Error('userId is required');
  }

  const { start, end } = buildWindow(options);
  const pageSize = clampPageSize(options.pageSize);
  const offset = parsePageToken(options.pageToken);

  if (isMockUser(trimmedUserId)) {
    return {
      events: [],
      nextPageToken: null,
      window: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
      updatedAt: null,
    };
  }

  const windowStartTs = Timestamp.fromDate(start);
  const windowEndTs = Timestamp.fromDate(end);

  const userDocRef = db.collection(PINNED_EVENTS_COLLECTION).doc(trimmedUserId);
  const entriesRef = userDocRef.collection(ENTRIES_SUBCOLLECTION);
  const seriesRef = userDocRef.collection(SERIES_SUBCOLLECTION);

  const [entrySnapshot, seriesSnapshot, userDoc] = await Promise.all([
    entriesRef
      .where('eventStartTime', '>=', windowStartTs)
      .where('eventStartTime', '<', windowEndTs)
      .orderBy('eventStartTime', 'asc')
      .orderBy('eventId', 'asc')
      .get(),
    seriesRef.get(),
    userDocRef.get(),
  ]);

  const directEntries = entrySnapshot.docs.map(mapPinnedEvent);
  const directEventIds = new Set(directEntries.map(entry => entry.eventId));

  const seriesSummaries = new Map<string, PinnedSeriesRecord>();
  for (const doc of seriesSnapshot.docs) {
    seriesSummaries.set(doc.id, mapPinnedSeriesDoc(doc));
  }

  const seriesEntries = await expandSeriesEntries(
    Array.from(seriesSummaries.keys()),
    seriesSummaries,
    start,
    end,
    directEventIds,
  );

  const combined = [...directEntries, ...seriesEntries];
  combined.sort(compareEntries);

  const paginated = combined.slice(offset, offset + pageSize);
  const nextPageToken = offset + pageSize < combined.length
    ? encodePageToken(offset + pageSize)
    : null;

  const updatedAt = userDoc.exists
    ? timestampToIso(extractTimestamp(userDoc.data()?.updatedAt))
    : null;

  return {
    events: paginated,
    nextPageToken,
    window: {
      start: start.toISOString(),
      end: end.toISOString(),
    },
    updatedAt,
  };
}

export async function getPinnedEventEntry(
  userId: string,
  eventId: string,
): Promise<PinnedEventEntry | null> {
  const trimmedUserId = userId.trim();
  const trimmedEventId = eventId.trim();

  if (!trimmedUserId) {
    throw new Error('userId is required');
  }

  if (!trimmedEventId) {
    throw new Error('eventId is required');
  }

  if (isMockUser(trimmedUserId)) {
    return null;
  }

  const doc = await db
    .collection(PINNED_EVENTS_COLLECTION)
    .doc(trimmedUserId)
    .collection(ENTRIES_SUBCOLLECTION)
    .doc(trimmedEventId)
    .get();

  if (!doc.exists) {
    return null;
  }

  return mapPinnedEvent(doc);
}

export {
  PINNED_EVENTS_COLLECTION,
  ENTRIES_SUBCOLLECTION,
  DEFAULT_TIME_ZONE,
};
