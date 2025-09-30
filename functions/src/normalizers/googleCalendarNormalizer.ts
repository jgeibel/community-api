import { CanonicalEvent, RawEventPayload } from '../models/event';
import { GoogleCalendarRawEvent } from '../connectors/googleCalendarConnector';

export function normalizeGoogleCalendarEvent(payload: RawEventPayload<GoogleCalendarRawEvent>): CanonicalEvent {
  const { raw } = payload;
  const title = raw.summary?.trim() || 'Untitled Event';
  const startTime = raw.start?.toISOString() ?? payload.fetchedAt;
  const endTime = raw.end?.toISOString();

  const description = raw.description ? decodeText(raw.description) : undefined;
  const sourceUrl = raw.url || buildGoogleEventUrl(raw.calendarId, raw.uid);
  const updatedAt = raw.raw.updated ?? payload.fetchedAt;

  return {
    id: buildCanonicalId(payload.sourceId, payload.sourceEventId),
    title,
    description,
    contentType: 'event',
    startTime,
    endTime,
    timeZone: raw.timezone,
    isAllDay: raw.isAllDay ?? false,
    recurrence: null,
    venue: buildVenue(raw.location),
    organizer: raw.organizer ?? null,
    price: null,
    tags: [],
    breadcrumbs: [
      {
        type: 'google-calendar-ics',
        sourceId: payload.sourceId,
        sourceEventId: payload.sourceEventId,
        fetchedAt: payload.fetchedAt,
        metadata: {
          fetchedUrl: raw.fetchedUrl,
        },
      },
    ],
    source: {
      sourceId: payload.sourceId,
      sourceEventId: payload.sourceEventId,
      sourceUrl,
    },
    status: raw.status,
    lastFetchedAt: payload.fetchedAt,
    lastUpdatedAt: updatedAt,
    rawSnapshotPath: undefined,
    vector: null,
  };
}

function buildCanonicalId(sourceId: string, sourceEventId: string): string {
  return `${sourceId}:${sourceEventId}`;
}

function buildVenue(rawLocation?: string) {
  if (!rawLocation) {
    return undefined;
  }

  return {
    name: rawLocation,
    rawLocation,
  };
}

function decodeText(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function buildGoogleEventUrl(calendarId: string, uid: string): string {
  if (!uid) {
    return `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(calendarId)}`;
  }

  const eventId = uid.includes('@') ? uid.split('@')[0] : uid;
  const encoded = Buffer.from(eventId).toString('base64').replace(/=+$/g, '');
  const cid = encodeURIComponent(calendarId);
  return `https://calendar.google.com/calendar/event?eid=${encoded}&cid=${cid}`;
}
