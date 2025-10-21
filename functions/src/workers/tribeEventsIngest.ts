import { ingestSource, type IngestStats, type SourceFetchOptions, type SourceHostConfig } from './sourceIngest';
import { TribeEventsAdapter } from '../connectors/tribeEventsAdapter';

export interface TribeEventsIngestConfig {
  baseUrl: string;
  label?: string;
  startDate?: Date;
  endDate?: Date;
  targetDate?: Date;
  forceRefresh?: boolean;
  host: SourceHostConfig;
}

export async function ingestTribeEvents(config: TribeEventsIngestConfig): Promise<IngestStats> {
  if ((config.startDate && !config.endDate) || (!config.startDate && config.endDate)) {
    throw new Error('startDate and endDate must be provided together');
  }

  const adapter = new TribeEventsAdapter({
    baseUrl: config.baseUrl,
    label: config.label,
  });

  const fetchOptions: SourceFetchOptions = {};
  if (config.targetDate) {
    fetchOptions.targetDate = config.targetDate;
  } else if (config.startDate && config.endDate) {
    fetchOptions.startDate = config.startDate;
    fetchOptions.endDateExclusive = config.endDate;
  }

  return ingestSource({
    adapter,
    fetchOptions,
    forceRefresh: config.forceRefresh,
    hostConfig: config.host,
  });
}

export type { IngestStats } from './sourceIngest';
