import type { RawEventPayload } from '../models/event';
import { GoogleCalendarConnector, type GoogleCalendarRawEvent } from './googleCalendarConnector';
import { normalizeGoogleCalendarEvent, serializeGoogleCalendarRawEvent } from '../normalizers/googleCalendarNormalizer';
import type { HostContext, NormalizedSourceEvent, SourceAdapter, SourceFetchOptions } from '../workers/sourceIngest';

interface GoogleCalendarAdapterConfig {
  calendarId: string;
  label?: string;
  timeZone?: string;
}

export class GoogleCalendarAdapter implements SourceAdapter<GoogleCalendarRawEvent> {
  private readonly connector: GoogleCalendarConnector;
  readonly label?: string;

  constructor(config: GoogleCalendarAdapterConfig) {
    this.connector = new GoogleCalendarConnector({
      calendarId: config.calendarId,
      label: config.label,
      timeZone: config.timeZone,
    });
    this.label = config.label;
  }

  get sourceId(): string {
    return this.connector.sourceId;
  }

  async fetchRawEvents(options?: SourceFetchOptions): Promise<Array<RawEventPayload<GoogleCalendarRawEvent>>> {
    if (options?.startDate && options?.endDateExclusive) {
      return this.connector.fetchRawEventsBetween(options.startDate, options.endDateExclusive);
    }
    if (options?.targetDate) {
      return this.connector.fetchRawEventsForDate(options.targetDate);
    }

    return this.connector.fetchRawEvents();
  }

  normalize(payload: RawEventPayload<GoogleCalendarRawEvent>): NormalizedSourceEvent<GoogleCalendarRawEvent> {
    const event = normalizeGoogleCalendarEvent(payload);
    const hostContext = deriveHostContext(event, payload, this.label);
    const rawSnapshot = serializeGoogleCalendarRawEvent(payload.raw);
    return {
      event,
      rawSnapshot,
      hostContext,
    };
  }
}

function deriveHostContext(
  event: ReturnType<typeof normalizeGoogleCalendarEvent>,
  payload: RawEventPayload<GoogleCalendarRawEvent>,
  label?: string,
): HostContext {
  const organizerFromEvent = sanitizeName(event.organizer);
  const organizerFromPayload = sanitizeName(
    payload.raw.raw.organizer?.displayName ?? payload.raw.raw.organizer?.email,
  );

  const organizer = organizerFromEvent ?? organizerFromPayload;

  return {
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
