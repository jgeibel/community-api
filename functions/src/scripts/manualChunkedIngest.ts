import { ingestGoogleCalendar } from '../workers/googleCalendarIngest';
import { addUtcDays, startOfDayInTimeZone } from '../utils/timezone';

const DEFAULT_CALENDAR_ID = '007c8904d97ab1f21a718fab5eab13f5d95d1b0506be7352161bae2aafa8bdd2@group.calendar.google.com';
const DEFAULT_TIME_ZONE = 'America/Los_Angeles';

function parseArgs(): {
  calendarId: string;
  startDate: Date;
  totalDays: number;
  chunkSizeDays: number;
} {
  const [, , calendarArg, startArg, totalDaysArg, chunkSizeArg] = process.argv;

  const calendarId = calendarArg && !calendarArg.startsWith('--')
    ? calendarArg
    : DEFAULT_CALENDAR_ID;

  const today = new Date();
  const startBase = startArg
    ? parseDate(startArg)
    : addUtcDays(startOfDayInTimeZone(today, DEFAULT_TIME_ZONE), -1);

  const totalDays = parsePositiveInt(totalDaysArg, 62);
  const chunkSizeDays = parsePositiveInt(chunkSizeArg, 5);

  if (chunkSizeDays > totalDays) {
    return {
      calendarId,
      startDate: startBase,
      totalDays,
      chunkSizeDays: totalDays,
    };
  }

  return {
    calendarId,
    startDate: startBase,
    totalDays,
    chunkSizeDays,
  };
}

function parseDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return startOfDayInTimeZone(parsed, DEFAULT_TIME_ZONE);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer: ${value}`);
  }
  return parsed;
}

async function run(): Promise<void> {
  const { calendarId, startDate, totalDays, chunkSizeDays } = parseArgs();

  console.log(`Chunked ingest for ${calendarId}`);
  console.log(`  window start: ${startDate.toISOString()}`);
  console.log(`  total days: ${totalDays}`);
  console.log(`  chunk size: ${chunkSizeDays}`);

  for (let offset = 0; offset < totalDays; offset += chunkSizeDays) {
    const chunkStart = addUtcDays(startDate, offset);
    const chunkEnd = addUtcDays(startDate, Math.min(offset + chunkSizeDays, totalDays));

    console.log(`\nProcessing chunk ${chunkStart.toISOString()} -> ${chunkEnd.toISOString()}`);
    const stats = await ingestGoogleCalendar({
      calendarId,
      startDate: chunkStart,
      endDate: chunkEnd,
      forceRefresh: true,
    });

    console.log('  chunk stats:', stats);
  }

  console.log('\nChunked ingest complete');
}

run().then(
  () => process.exit(0),
  error => {
    console.error('Chunked ingest failed', error);
    process.exit(1);
  },
);
