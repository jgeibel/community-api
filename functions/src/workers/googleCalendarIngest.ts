import { ingestSource, type IngestStats, type SourceFetchOptions, type SourceHostConfig } from './sourceIngest';
import { GoogleCalendarAdapter } from '../connectors/googleCalendarAdapter';

export interface GoogleCalendarIngestConfig {
  calendarId: string;
  label?: string;
  targetDate?: Date;
  startDate?: Date;
  endDate?: Date;
  forceRefresh?: boolean;
  host: SourceHostConfig;
}

export async function ingestGoogleCalendar(config: GoogleCalendarIngestConfig): Promise<IngestStats> {
  if ((config.startDate && !config.endDate) || (!config.startDate && config.endDate)) {
    throw new Error('startDate and endDate must be provided together');
  }

  const adapter = new GoogleCalendarAdapter({
    calendarId: config.calendarId,
    label: config.label,
  });

  const fetchOptions: SourceFetchOptions = {};
  if (config.startDate && config.endDate) {
    fetchOptions.startDate = config.startDate;
    fetchOptions.endDateExclusive = config.endDate;
  } else if (config.targetDate) {
    fetchOptions.targetDate = config.targetDate;
  }

  return ingestSource({
    adapter,
    fetchOptions,
    forceRefresh: config.forceRefresh,
    hostConfig: config.host,
  });
}

export type { IngestStats } from './sourceIngest';
