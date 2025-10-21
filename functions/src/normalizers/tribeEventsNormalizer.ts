import { stripHtml } from '../utils/html';
import type { CanonicalEvent, RawEventPayload } from '../models/event';
import type { TribeEventsRawEvent } from '../connectors/tribeEventsConnector';

export function normalizeTribeEventsEvent(payload: RawEventPayload<TribeEventsRawEvent>): CanonicalEvent {
  const { raw } = payload;

  const title = (raw.title ?? '').trim() || 'Untitled Event';
  const description = raw.description ? buildDescription(raw.description) : undefined;
  const startTime = toIsoString(raw.utcStartDate) ?? payload.fetchedAt;
  const endTime = toIsoString(raw.utcEndDate);
  const organizer = selectOrganizer(raw);
  const tags = buildInitialTags(raw);
  const updatedAt = toIsoString(raw.modifiedUtc) ?? payload.fetchedAt;

  return {
    id: buildCanonicalId(payload.sourceId, payload.sourceEventId),
    title,
    description,
    contentType: 'event',
    startTime,
    endTime,
    timeZone: raw.timezone,
    isAllDay: raw.allDay ?? false,
    recurrence: null,
    venue: buildVenue(raw),
    organizer,
    price: raw.cost?.trim() || null,
    tags,
    breadcrumbs: [{
      type: 'tribe-events-api',
      sourceId: payload.sourceId,
      sourceEventId: payload.sourceEventId,
      fetchedAt: payload.fetchedAt,
      metadata: {
        fetchedUrl: raw.fetchedUrl,
        restUrl: raw.restUrl,
        status: raw.status,
      },
    }],
    source: {
      sourceId: payload.sourceId,
      sourceEventId: payload.sourceEventId,
      sourceUrl: raw.url,
    },
    status: raw.status,
    lastFetchedAt: payload.fetchedAt,
    lastUpdatedAt: updatedAt,
    rawSnapshotPath: undefined,
    vector: null,
  };
}

export function serializeTribeEventsRawEvent(raw: TribeEventsRawEvent): Record<string, unknown> {
  const venue = raw.venue
    ? {
        id: raw.venue.id,
        venue: raw.venue.venue,
        address: raw.venue.address,
        city: raw.venue.city,
        state: raw.venue.state ?? raw.venue.province ?? raw.venue.stateprovince,
        zip: raw.venue.zip,
        country: raw.venue.country,
      }
    : null;

  const organizers = raw.organizers.map(organizer => ({
    id: organizer.id,
    organizer: organizer.organizer,
    phone: organizer.phone,
    website: organizer.website,
    email: organizer.email,
  }));

  const snapshot: Record<string, unknown> = {
    id: raw.id,
    status: raw.status,
    startDate: raw.startDate,
    endDate: raw.endDate,
    utcStartDate: raw.utcStartDate,
    utcEndDate: raw.utcEndDate,
    timezone: raw.timezone,
    allDay: raw.allDay,
    cost: raw.cost,
    website: raw.website,
    categories: raw.categories,
    tags: raw.tags,
    venue,
    organizers,
    modifiedUtc: raw.modifiedUtc,
    fetchedUrl: raw.fetchedUrl,
    restUrl: raw.restUrl,
  };

  for (const key of Object.keys(snapshot)) {
    if (snapshot[key] === undefined) {
      delete snapshot[key];
    }
  }

  return snapshot;
}

function buildCanonicalId(sourceId: string, sourceEventId: string): string {
  return `${sourceId}:${sourceEventId}`;
}

function buildDescription(value: string): string {
  return stripHtml(value);
}

function buildInitialTags(raw: TribeEventsRawEvent): string[] {
  const items = [...(raw.categories ?? []), ...(raw.tags ?? [])];
  const set = new Set(
    items
      .map(item => item?.trim().toLowerCase())
      .filter((item): item is string => Boolean(item && item.length > 0)),
  );
  return Array.from(set);
}

function buildVenue(raw: TribeEventsRawEvent) {
  if (!raw.venue) {
    return undefined;
  }

  const addressParts = [
    raw.venue.address,
    raw.venue.city,
    raw.venue.state ?? raw.venue.province ?? raw.venue.stateprovince,
    raw.venue.zip,
    raw.venue.country,
  ]
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join(', ');

  return {
    name: raw.venue.venue ?? undefined,
    address: addressParts || undefined,
    rawLocation: [raw.venue.venue, addressParts].filter(Boolean).join(' • ') || undefined,
  };
}

function selectOrganizer(raw: TribeEventsRawEvent): string | null {
  const primary = raw.organizers.find(item => item.organizer && item.organizer.trim().length > 0);
  return primary?.organizer?.trim() ?? null;
}

function toIsoString(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.includes('T') ? value.replace(' ', 'T') : value.replace(' ', 'T');
  const withZone = normalized.endsWith('Z') ? normalized : `${normalized}Z`;
  const date = new Date(withZone);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
}
