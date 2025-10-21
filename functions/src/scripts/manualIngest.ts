import { ingestGoogleCalendar } from '../workers/googleCalendarIngest';
import { addUtcDays, startOfDayInTimeZone } from '../utils/timezone';
import { COMMUNITY_EVENT_SOURCES } from '../index';
import type { SourceHostConfig } from '../workers/sourceIngest';

const DEFAULT_CALENDAR_ID = '007c8904d97ab1f21a718fab5eab13f5d95d1b0506be7352161bae2aafa8bdd2@group.calendar.google.com';
const DEFAULT_TIME_ZONE = 'America/Los_Angeles';
const DEFAULT_DAYS = 62; // 1 day lookback + 61 day horizon
const DEFAULT_HOST_CONFIG = resolveHostConfig(DEFAULT_CALENDAR_ID);

function parseDate(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return parsed;
}

async function run(): Promise<void> {
  const [, , calendarArg, startArg, daysArg] = process.argv;

  const calendarId = calendarArg && !calendarArg.startsWith('--')
    ? calendarArg
    : DEFAULT_CALENDAR_ID;

  const hostConfig = calendarId === DEFAULT_CALENDAR_ID
    ? DEFAULT_HOST_CONFIG
    : resolveHostConfig(calendarId);

  const explicitDays = daysArg ? Number.parseInt(daysArg, 10) : undefined;
  if (explicitDays !== undefined && (!Number.isFinite(explicitDays) || explicitDays <= 0)) {
    throw new Error('days must be a positive integer when provided');
  }

  const today = new Date();
  const startBase = startArg ? parseDate(startArg) : undefined;
  const windowStart = startBase
    ? startOfDayInTimeZone(startBase, DEFAULT_TIME_ZONE)
    : addUtcDays(startOfDayInTimeZone(today, DEFAULT_TIME_ZONE), -1); // include one-day lookback

  const daysToCover = explicitDays ?? DEFAULT_DAYS;
  const windowEnd = addUtcDays(windowStart, daysToCover);

  console.log(`Starting ingest for ${calendarId}`);
  console.log(`  Window: ${windowStart.toISOString()} -> ${windowEnd.toISOString()}`);

  const stats = await ingestGoogleCalendar({
    calendarId,
    startDate: windowStart,
    endDate: windowEnd,
    forceRefresh: true,
    host: hostConfig,
  });

  console.log('Ingest complete:', stats);
}

run().then(
  () => process.exit(0),
  error => {
    console.error('Manual ingest failed', error);
    process.exit(1);
  },
);

function resolveHostConfig(calendarId: string): SourceHostConfig {
  const source = COMMUNITY_EVENT_SOURCES.find(
    candidate => candidate.kind === 'google-calendar' && candidate.calendarId === calendarId,
  );
  if (!source) {
    throw new Error(`No host configuration found for calendar ${calendarId}`);
  }
  return source.host;
}
