import * as functions from 'firebase-functions/v1';
import apiApp from './api/routes';
import { ingestGoogleCalendar } from './workers/googleCalendarIngest';
import type { Request, Response } from 'express';
import type { IngestStats } from './workers/googleCalendarIngest';
import { addUtcDays, startOfDayInTimeZone } from './utils/timezone';

const COMMUNITY_GOOGLE_CALENDARS = [
  {
    calendarId: '007c8904d97ab1f21a718fab5eab13f5d95d1b0506be7352161bae2aafa8bdd2@group.calendar.google.com',
    label: 'Community Events Calendar',
  },
];

export const syncCommunityEvents = functions
  .runWith({
    timeoutSeconds: 540,
    memory: '512MB',
  })
  .pubsub
  .schedule('*/30 * * * *')
  .timeZone('America/Los_Angeles')
  .onRun(async () => {
    for (const calendar of COMMUNITY_GOOGLE_CALENDARS) {
      try {
        const stats = await ingestCalendarInChunks(calendar);
        console.log(
          `Synced ${calendar.calendarId}: fetched=${stats.fetched} created=${stats.created} updated=${stats.updated} skipped=${stats.skipped}`
        );
      } catch (error) {
        console.error(`Failed to sync calendar ${calendar.calendarId}`, error);
      }
    }

    return null;
  });

export const triggerCommunityEventsSync = functions
  .runWith({
    timeoutSeconds: 540,
    memory: '512MB',
  })
  .https.onRequest(async (req: Request, res: Response) => {
    const calendarId = (req.query.calendarId as string | undefined) ?? undefined;
    const startRangeParam = (req.query.start as string | undefined)?.trim();
    const daysParamRaw = (req.query.days as string | undefined)?.trim();
    const chunkParamRaw = (req.query.chunkSize as string | undefined)?.trim();
    const forceRefreshParam = (req.query.forceRefresh as string | undefined)?.toLowerCase() === 'true';

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
          chunkSizeDays: chunkSizeOverride ?? (totalSpanDays ?? CHUNK_DAYS),
          forceRefresh: forceRefreshParam,
        };
      }
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid parameters' });
      return;
    }

    const targets = calendarId
      ? [{ calendarId, label: `Manual trigger (${calendarId})` }]
      : COMMUNITY_GOOGLE_CALENDARS;

    const optionsWithForce: ChunkOptions | undefined = chunkOptions
      ? { ...chunkOptions, forceRefresh: forceRefreshParam }
      : forceRefreshParam
        ? { forceRefresh: true }
        : undefined;

    const results: Array<Record<string, unknown>> = [];
    let hasError = false;

    for (const calendar of targets) {
      try {
        const stats = await ingestCalendarInChunks(calendar, optionsWithForce);
        results.push({
          calendarId: calendar.calendarId,
          stats,
        });
      } catch (error) {
        hasError = true;
        results.push({
          calendarId: calendar.calendarId,
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
  })
  .https.onRequest(async (req: Request, res: Response) => {
    const dateParam = (req.query.date as string | undefined)?.trim();
    if (!dateParam) {
      res.status(400).json({ error: 'Missing required date parameter (YYYY-MM-DD)' });
      return;
    }

    const forceRefresh = (req.query.forceRefresh as string | undefined)?.toLowerCase() === 'true';

    const parsed = new Date(dateParam);
    if (Number.isNaN(parsed.getTime())) {
      res.status(400).json({ error: 'Invalid date parameter' });
      return;
    }

    parsed.setHours(0, 0, 0, 0);

    const calendarId = req.query.calendarId ?? undefined;
    const targets = calendarId
      ? [{ calendarId: String(calendarId), label: `Manual single-day trigger (${calendarId})` }]
      : COMMUNITY_GOOGLE_CALENDARS;

    const results: Array<{ calendarId: string; stats?: IngestStats; error?: string }> = [];
    let hasError = false;

    for (const calendar of targets) {
      try {
        const stats = await ingestGoogleCalendar({
          calendarId: calendar.calendarId,
          label: calendar.label,
          targetDate: new Date(parsed),
          forceRefresh,
        });
        results.push({
          calendarId: calendar.calendarId,
          stats,
        });
      } catch (error) {
        hasError = true;
        results.push({
          calendarId: calendar.calendarId,
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

const LOOK_BACK_DAYS = 1;
const LOOK_AHEAD_DAYS = 60;
const CHUNK_DAYS = 7;
const DEFAULT_TIME_ZONE = 'America/Los_Angeles';

interface ChunkOptions {
  startDate?: Date;
  totalSpanDays?: number;
  chunkSizeDays?: number;
  forceRefresh?: boolean;
}

async function ingestCalendarInChunks(
  calendar: { calendarId: string; label?: string },
  options?: ChunkOptions,
): Promise<IngestStats> {
  const now = new Date();
  const chunkSize = options?.chunkSizeDays ?? CHUNK_DAYS;
  if (chunkSize <= 0) {
    throw new Error('chunkSizeDays must be greater than 0');
  }
  const windowStart = options?.startDate
    ? new Date(options.startDate)
    : addUtcDays(startOfDayInTimeZone(now, DEFAULT_TIME_ZONE), -LOOK_BACK_DAYS);
  const totalSpanDays = options?.totalSpanDays ?? LOOK_BACK_DAYS + LOOK_AHEAD_DAYS + 1;

  const aggregate: IngestStats = {
    sourceId: `google-calendar:${calendar.calendarId}`,
    fetched: 0,
    created: 0,
    updated: 0,
    skipped: 0,
  };

  for (let offset = 0; offset < totalSpanDays; offset += chunkSize) {
    const chunkStart = addUtcDays(windowStart, offset);
    const chunkEnd = addUtcDays(windowStart, Math.min(offset + chunkSize, totalSpanDays));

    const stats = await ingestGoogleCalendar({
      calendarId: calendar.calendarId,
      label: calendar.label,
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
      `Chunk ${chunkStart.toISOString()} -> ${chunkEnd.toISOString()} for ${calendar.calendarId}: fetched=${stats.fetched} created=${stats.created} updated=${stats.updated} skipped=${stats.skipped}`
    );
  }

  return aggregate;
}

export const api = functions
  .runWith({
    timeoutSeconds: 60,
    memory: '256MB',
  })
  .https.onRequest(apiApp);
