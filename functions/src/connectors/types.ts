import { RawEventPayload } from '../models/event';

export interface SourceConnector<T = unknown> {
  readonly sourceId: string;
  fetchRawEvents(): Promise<Array<RawEventPayload<T>>>;
}

export interface GoogleCalendarConfig {
  calendarId: string;
  label?: string;
  timeZone?: string;
}
