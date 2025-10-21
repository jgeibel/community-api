import type { RawEventPayload } from '../models/event';
import { TribeEventsConnector, type TribeEventsRawEvent } from './tribeEventsConnector';
import { normalizeTribeEventsEvent, serializeTribeEventsRawEvent } from '../normalizers/tribeEventsNormalizer';
import type { HostContext, NormalizedSourceEvent, SourceAdapter, SourceFetchOptions } from '../workers/sourceIngest';
import { buildStableId, createSlug } from '../utils/slug';

interface TribeEventsAdapterConfig {
  baseUrl: string;
  label?: string;
  perPage?: number;
}

export class TribeEventsAdapter implements SourceAdapter<TribeEventsRawEvent> {
  private readonly connector: TribeEventsConnector;
  readonly label?: string;

  constructor(config: TribeEventsAdapterConfig) {
    this.connector = new TribeEventsConnector({
      baseUrl: config.baseUrl,
      label: config.label,
      perPage: config.perPage,
    });
    this.label = config.label ?? this.connector.label;
  }

  get sourceId(): string {
    return this.connector.sourceId;
  }

  async fetchRawEvents(options?: SourceFetchOptions): Promise<Array<RawEventPayload<TribeEventsRawEvent>>> {
    const params: Record<string, string> = {
      status: 'publish',
    };

    if (options?.targetDate) {
      const dateStr = formatDate(options.targetDate);
      params.start_date = dateStr;
      params.end_date = dateStr;
    } else {
      if (options?.startDate) {
        params.start_date = formatDate(options.startDate);
      }
      if (options?.endDateExclusive) {
        const endInclusive = new Date(options.endDateExclusive.getTime() - 1);
        params.end_date = formatDate(endInclusive);
      }
    }

    return this.connector.fetchRawEventsWithParams(params);
  }

  normalize(payload: RawEventPayload<TribeEventsRawEvent>): NormalizedSourceEvent<TribeEventsRawEvent> {
    const event = normalizeTribeEventsEvent(payload);
    const hostContext = deriveHostContext(event, payload.raw, this.label);
    const rawSnapshot = serializeTribeEventsRawEvent(payload.raw);

    return {
      event,
      rawSnapshot,
      hostContext,
    };
  }
}

function deriveHostContext(
  event: ReturnType<typeof normalizeTribeEventsEvent>,
  raw: TribeEventsRawEvent,
  label?: string,
): HostContext {
  const organizer = sanitizeName(event.organizer) ?? sanitizeName(raw.organizers[0]?.organizer);
  const venueName = sanitizeName(raw.venue?.venue);
  const fallback = organizer ?? venueName ?? sanitizeName(label) ?? 'Orcas Center';

  const hostIdSeed = buildStableId(
    [
      organizer,
      venueName,
      label,
      event.source.sourceId,
      event.source.sourceEventId,
    ],
    createSlug(fallback || 'host'),
  ) || createSlug(event.source.sourceId) || 'host';

  const hostName = organizer ?? venueName ?? sanitizeName(label) ?? fallback ?? null;

  return {
    hostIdSeed,
    hostName,
    organizer,
  };
}

function sanitizeName(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
