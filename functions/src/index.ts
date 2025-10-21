import * as functions from 'firebase-functions/v1';
import type { Request, Response } from 'express';
import apiApp from './api/routes';
import { ingestGoogleCalendar } from './workers/googleCalendarIngest';
import { ingestTribeEvents } from './workers/tribeEventsIngest';
import type { IngestStats } from './workers/sourceIngest';
import { addUtcDays, startOfDayInTimeZone } from './utils/timezone';

const DEFAULT_TIME_ZONE = 'America/Los_Angeles';

interface ScheduleConfig {
  lookBackDays: number;
  lookAheadDays: number;
  chunkSizeDays: number;
}

interface BaseCommunitySource {
  id: string;
  label?: string;
  schedule: ScheduleConfig;
}

interface GoogleCalendarSource extends BaseCommunitySource {
  kind: 'google-calendar';
  calendarId: string;
}

interface TribeEventsSource extends BaseCommunitySource {
  kind: 'tribe-events';
  baseUrl: string;
}

type CommunitySource = GoogleCalendarSource | TribeEventsSource;

const COMMUNITY_EVENT_SOURCES: CommunitySource[] = [
  {
    id: 'community-google-calendar',
    kind: 'google-calendar',
    calendarId: '007c8904d97ab1f21a718fab5eab13f5d95d1b0506be7352161bae2aafa8bdd2@group.calendar.google.com',
    label: 'Community Events Calendar',
    schedule: {
      lookBackDays: 1,
      lookAheadDays: 60,
      chunkSizeDays: 7,
    },
  },
  {
    id: 'orcas-center-events',
    kind: 'tribe-events',
    baseUrl: 'https://orcascenter.org',
    label: 'Orcas Center',
    schedule: {
      lookBackDays: 14,
      lookAheadDays: 120,
      chunkSizeDays: 15,
    },
  },
];

export const syncCommunityEvents = functions
  .runWith({
    timeoutSeconds: 540,
    memory: '512MB',
    secrets: ['OPENAI_API_KEY', 'GOOGLE_CALENDAR_API_KEY'],
  })
  .pubsub
  .schedule('*/30 * * * *')
  .timeZone(DEFAULT_TIME_ZONE)
  .onRun(async () => {
    for (const source of COMMUNITY_EVENT_SOURCES) {
      try {
        const stats = await ingestSourceInChunks(source);
        console.log(
          `[${source.id}] Synced ${getAdapterSourceId(source)}: fetched=${stats.fetched} created=${stats.created} updated=${stats.updated} skipped=${stats.skipped}`,
        );
      } catch (error) {
        console.error(`Failed to sync ${source.id}`, error);
      }
    }

    return null;
  });

export const triggerCommunityEventsSync = functions
  .runWith({
    timeoutSeconds: 540,
    memory: '512MB',
    secrets: ['OPENAI_API_KEY', 'GOOGLE_CALENDAR_API_KEY'],
  })
  .https.onRequest(async (req: Request, res: Response) => {
    const sourceIdParam = (req.query.sourceId as string | undefined)?.trim();
    const calendarIdParam = (req.query.calendarId as string | undefined)?.trim();
    const baseUrlParam = (req.query.baseUrl as string | undefined)?.trim();
    const startRangeParam = (req.query.start as string | undefined)?.trim();
    const daysParamRaw = (req.query.days as string | undefined)?.trim();
    const chunkParamRaw = (req.query.chunkSize as string | undefined)?.trim();
    const forceRefresh = (req.query.forceRefresh as string | undefined)?.toLowerCase() === 'true';

    let chunkOptions: ChunkOptions | undefined;

    try {
      if (startRangeParam || daysParamRaw || chunkParamRaw) {
        let startDate: Date | undefined;
        if (startRangeParam) {
          const parsed = new Date(startRangeParam);
          if (Number.isNaN(parsed.getTime())) {
            throw new Error('Invalid start date');
          }
          startDate = startOfDayInTimeZone(parsed, DEFAULT_TIME_ZONE);
        }

        let totalSpanDays: number | undefined;
        if (daysParamRaw) {
          const parsedDays = Number.parseInt(daysParamRaw, 10);
          if (!Number.isFinite(parsedDays) || parsedDays <= 0) {
            throw new Error('days must be a positive integer');
          }
          totalSpanDays = parsedDays;
        }

        let chunkSizeOverride: number | undefined;
        if (chunkParamRaw) {
          const parsedChunk = Number.parseInt(chunkParamRaw, 10);
          if (!Number.isFinite(parsedChunk) || parsedChunk <= 0) {
            throw new Error('chunkSize must be a positive integer');
          }
          chunkSizeOverride = parsedChunk;
        }

        chunkOptions = {
          startDate,
          totalSpanDays,
          chunkSizeDays: chunkSizeOverride,
          forceRefresh,
        };
      }
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid parameters' });
      return;
    }

    const targets = selectSources({ sourceId: sourceIdParam, calendarId: calendarIdParam, baseUrl: baseUrlParam });
    if (targets.length === 0) {
      res.status(404).json({ error: 'No matching source found' });
      return;
    }

    const optionsForIngest = chunkOptions
      ? { ...chunkOptions, forceRefresh }
      : forceRefresh
        ? { forceRefresh }
        : undefined;

    const results: Array<Record<string, unknown>> = [];
    let hasError = false;

    for (const source of targets) {
      try {
        const stats = await ingestSourceInChunks(source, optionsForIngest);
        results.push({
          sourceId: getAdapterSourceId(source),
          stats,
        });
      } catch (error) {
        hasError = true;
        results.push({
          sourceId: getAdapterSourceId(source),
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    res.status(hasError ? 500 : 200).json({
      success: !hasError,
      results,
    });
  });

export const triggerCommunityEventsSyncForDay = functions
  .runWith({
    timeoutSeconds: 300,
    memory: '512MB',
    secrets: ['OPENAI_API_KEY', 'GOOGLE_CALENDAR_API_KEY'],
  })
  .https.onRequest(async (req: Request, res: Response) => {
    const dateParam = (req.query.date as string | undefined)?.trim();
    if (!dateParam) {
      res.status(400).json({ error: 'Missing required date parameter (YYYY-MM-DD)' });
      return;
    }

    const forceRefresh = (req.query.forceRefresh as string | undefined)?.toLowerCase() === 'true';
    const sourceIdParam = (req.query.sourceId as string | undefined)?.trim();
    const calendarIdParam = (req.query.calendarId as string | undefined)?.trim();
    const baseUrlParam = (req.query.baseUrl as string | undefined)?.trim();

    const parsed = new Date(dateParam);
    if (Number.isNaN(parsed.getTime())) {
      res.status(400).json({ error: 'Invalid date parameter' });
      return;
    }

    parsed.setHours(0, 0, 0, 0);

    const targets = selectSources({ sourceId: sourceIdParam, calendarId: calendarIdParam, baseUrl: baseUrlParam });
    if (targets.length === 0) {
      res.status(404).json({ error: 'No matching source found' });
      return;
    }

    const results: Array<{ sourceId: string; stats?: IngestStats; error?: string }> = [];
    let hasError = false;

    for (const source of targets) {
      try {
        const stats = await ingestSourceForDate(source, parsed, forceRefresh);
        results.push({
          sourceId: getAdapterSourceId(source),
          stats,
        });
      } catch (error) {
        hasError = true;
        results.push({
          sourceId: getAdapterSourceId(source),
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    res.status(hasError ? 500 : 200).json({
      success: !hasError,
      date: parsed.toISOString().split('T')[0],
      results,
    });
  });

interface ChunkOptions {
  startDate?: Date;
  totalSpanDays?: number;
  chunkSizeDays?: number;
  forceRefresh?: boolean;
}

interface WindowIngestOptions {
  startDate?: Date;
  endDate?: Date;
  targetDate?: Date;
  forceRefresh?: boolean;
}

async function ingestSourceInChunks(source: CommunitySource, options?: ChunkOptions): Promise<IngestStats> {
  const schedule = source.schedule;
  const chunkSize = options?.chunkSizeDays ?? schedule.chunkSizeDays;
  const now = new Date();
  const windowStart = options?.startDate
    ? new Date(options.startDate)
    : addUtcDays(startOfDayInTimeZone(now, DEFAULT_TIME_ZONE), -schedule.lookBackDays);
  const totalSpanDays = options?.totalSpanDays ?? schedule.lookBackDays + schedule.lookAheadDays + 1;

  if (!chunkSize || chunkSize <= 0 || chunkSize >= totalSpanDays) {
    const stats = await ingestSourceWindow(source, {
      startDate: windowStart,
      endDate: addUtcDays(windowStart, totalSpanDays),
      forceRefresh: options?.forceRefresh,
    });
    console.log(
      `[${source.id}] Window ${windowStart.toISOString()} -> ${addUtcDays(windowStart, totalSpanDays).toISOString()}: fetched=${stats.fetched} created=${stats.created} updated=${stats.updated} skipped=${stats.skipped}`,
    );
    return stats;
  }

  const aggregate: IngestStats = {
    sourceId: getAdapterSourceId(source),
    fetched: 0,
    created: 0,
    updated: 0,
    skipped: 0,
  };

  for (let offset = 0; offset < totalSpanDays; offset += chunkSize) {
    const chunkStart = addUtcDays(windowStart, offset);
    const chunkEnd = addUtcDays(windowStart, Math.min(offset + chunkSize, totalSpanDays));

    const stats = await ingestSourceWindow(source, {
      startDate: new Date(chunkStart),
      endDate: new Date(chunkEnd),
      forceRefresh: options?.forceRefresh,
    });

    aggregate.fetched += stats.fetched;
    aggregate.created += stats.created;
    aggregate.updated += stats.updated;
    aggregate.skipped += stats.skipped;
    aggregate.sourceId = stats.sourceId;

    console.log(
      `[${source.id}] Chunk ${chunkStart.toISOString()} -> ${chunkEnd.toISOString()}: fetched=${stats.fetched} created=${stats.created} updated=${stats.updated} skipped=${stats.skipped}`,
    );
  }

  return aggregate;
}

async function ingestSourceWindow(source: CommunitySource, options: WindowIngestOptions): Promise<IngestStats> {
  if (source.kind === 'google-calendar') {
    return ingestGoogleCalendar({
      calendarId: source.calendarId,
      label: source.label,
      startDate: options.startDate,
      endDate: options.endDate,
      targetDate: options.targetDate,
      forceRefresh: options.forceRefresh,
    });
  }

  return ingestTribeEvents({
    baseUrl: source.baseUrl,
    label: source.label,
    startDate: options.startDate,
    endDate: options.endDate,
    targetDate: options.targetDate,
    forceRefresh: options.forceRefresh,
  });
}

async function ingestSourceForDate(source: CommunitySource, date: Date, forceRefresh: boolean): Promise<IngestStats> {
  return ingestSourceWindow(source, {
    targetDate: new Date(date),
    forceRefresh,
  });
}

function selectSources(filters: { sourceId?: string | null; calendarId?: string | null; baseUrl?: string | null }): CommunitySource[] {
  if (filters.sourceId) {
    return COMMUNITY_EVENT_SOURCES.filter(source =>
      getAdapterSourceId(source) === filters.sourceId ||
      source.id === filters.sourceId,
    );
  }

  if (filters.calendarId) {
    return COMMUNITY_EVENT_SOURCES.filter(
      source => source.kind === 'google-calendar' && source.calendarId === filters.calendarId,
    );
  }

  if (filters.baseUrl) {
    return COMMUNITY_EVENT_SOURCES.filter(
      source => source.kind === 'tribe-events' && source.baseUrl === filters.baseUrl,
    );
  }

  return COMMUNITY_EVENT_SOURCES;
}

function getAdapterSourceId(source: CommunitySource): string {
  if (source.kind === 'google-calendar') {
    return `google-calendar:${source.calendarId}`;
  }

  const host = new URL(source.baseUrl).hostname;
  return `tribe-events:${host}`;
}

export const api = functions
  .runWith({
    timeoutSeconds: 60,
    memory: '256MB',
  })
  .https.onRequest(apiApp);
