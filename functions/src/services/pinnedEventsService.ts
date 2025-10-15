import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { firestore } from '../firebase/admin';
import { addUtcDays, startOfDayInTimeZone } from '../utils/timezone';

const PINNED_EVENTS_COLLECTION = 'userPinnedEvents';
const ENTRIES_SUBCOLLECTION = 'entries';
const DEFAULT_TIME_ZONE = 'America/Los_Angeles';
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 30;

const db = firestore;

export interface PinnedEventEntry {
  eventId: string;
  title: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  tags: string[];
  contentType: string | null;
  source?: string | null;
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

interface PageTokenPayload {
  eventStartTime: string;
  eventId: string;
}

function isMockUser(userId: string): boolean {
  return userId.startsWith('mock-');
}

function parsePageToken(token?: string): PageTokenPayload | null {
  if (!token) {
    return null;
  }

  try {
    const json = Buffer.from(token, 'base64').toString('utf8');
    const payload = JSON.parse(json) as PageTokenPayload;
    if (typeof payload.eventStartTime !== 'string' || typeof payload.eventId !== 'string') {
      return null;
    }
    return payload;
  } catch (error) {
    console.warn('Failed to parse pinned events page token', error);
    return null;
  }
}

function encodePageToken(payload: PageTokenPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64');
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

  // Default: from now through next 30 days
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

function mapPinnedEvent(doc: FirebaseFirestore.DocumentSnapshot): PinnedEventEntry {
  const data = doc.data() ?? {};

  return {
    eventId: data.eventId ?? doc.id,
    title: typeof data.title === 'string' ? data.title : null,
    startTime: timestampToIso(extractTimestamp(data.eventStartTime)),
    endTime: timestampToIso(extractTimestamp(data.eventEndTime)),
    location: typeof data.location === 'string' ? data.location : null,
    tags: sanitizeTags(data.tags),
    contentType: typeof data.contentType === 'string' ? data.contentType : null,
    source: typeof data.source === 'string' ? data.source : null,
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

  return {
    title: typeof data.title === 'string' ? data.title : null,
    location: typeof data.location === 'string' ? data.location : null,
    tags: sanitizeTags(data.tags),
    startTime: startTs,
    endTime: endTs,
    contentType: typeof data.contentType === 'string' ? data.contentType : null,
    source: typeof data.source === 'string' ? data.source : null,
  };
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

export async function applyPinToggle(
  userId: string,
  eventId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const activeField = metadata ? metadata['active'] : undefined;
  const activeValue = typeof activeField === 'boolean'
    ? activeField
    : true;

  await setPinnedEventStatus(userId, eventId, activeValue);
}

function decodePageTokenOrThrow(token?: string): PageTokenPayload | null {
  if (!token) {
    return null;
  }
  const payload = parsePageToken(token);
  if (!payload) {
    throw new Error('Invalid page token');
  }
  return payload;
}

function clampPageSize(pageSize?: number): number {
  if (!pageSize || Number.isNaN(pageSize)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.max(Math.floor(pageSize), 1), MAX_PAGE_SIZE);
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
  const cursor = decodePageTokenOrThrow(options.pageToken);

  const windowStartTs = Timestamp.fromDate(start);
  const windowEndTs = Timestamp.fromDate(end);

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

  const userDocRef = db.collection(PINNED_EVENTS_COLLECTION).doc(trimmedUserId);
  const entriesRef = userDocRef.collection(ENTRIES_SUBCOLLECTION);

  let query: FirebaseFirestore.Query = entriesRef
    .where('eventStartTime', '>=', windowStartTs)
    .where('eventStartTime', '<', windowEndTs)
    .orderBy('eventStartTime', 'asc')
    .orderBy('eventId', 'asc');

  if (cursor) {
    const cursorTimestamp = extractTimestamp(cursor.eventStartTime);
    if (!cursorTimestamp) {
      throw new Error('Invalid page token');
    }
    query = query.startAfter(cursorTimestamp, cursor.eventId);
  }

  const snapshotPromise = query.limit(pageSize + 1).get();
  const userDocPromise = userDocRef.get();
  const [snapshot, userDoc] = await Promise.all([snapshotPromise, userDocPromise]);

  const docs = snapshot.docs.slice(0, pageSize);
  const events = docs.map(mapPinnedEvent);

  let nextPageToken: string | null = null;
  if (snapshot.docs.length > pageSize) {
    const lastDoc = docs[docs.length - 1];
    const lastData = lastDoc.data();
    const lastStartTime = extractTimestamp(lastData.eventStartTime);
    if (lastStartTime) {
      nextPageToken = encodePageToken({
        eventStartTime: lastStartTime.toDate().toISOString(),
        eventId: lastDoc.id,
      });
    }
  }

  const updatedAt = userDoc.exists
    ? timestampToIso(extractTimestamp(userDoc.data()?.updatedAt))
    : null;

  return {
    events,
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

export { PINNED_EVENTS_COLLECTION, ENTRIES_SUBCOLLECTION, DEFAULT_TIME_ZONE };
