import {
  COMMUNITY_EVENT_SOURCES,
  type ChunkOptions,
  getAdapterSourceId,
  ingestSourceInChunks,
  selectSources,
} from '../index';
import { startOfDayInTimeZone } from '../utils/timezone';

const DEFAULT_TIME_ZONE = 'America/Los_Angeles';

interface CliOptions {
  sourceId?: string;
  calendarId?: string;
  baseUrl?: string;
  startDate?: Date;
  totalSpanDays?: number;
  chunkSizeDays?: number;
  forceRefresh: boolean;
  listOnly: boolean;
}

function parseCliOptions(argv: string[]): CliOptions {
  let sourceId: string | undefined;
  let calendarId: string | undefined;
  let baseUrl: string | undefined;
  let startDate: Date | undefined;
  let totalSpanDays: number | undefined;
  let chunkSizeDays: number | undefined;
  let forceRefresh = true;
  let listOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--list') {
      listOnly = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const [flag, inlineValue] = arg.includes('=')
      ? arg.split('=', 2)
      : [arg, undefined];

    const getValue = (): string => {
      if (inlineValue !== undefined) {
        return inlineValue;
      }
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) {
        throw new Error(`Argument ${flag} requires a value`);
      }
      index += 1;
      return next;
    };

    switch (flag) {
      case '--sourceId':
        sourceId = getValue();
        break;
      case '--calendarId':
        calendarId = getValue();
        break;
      case '--baseUrl':
        baseUrl = getValue();
        break;
      case '--start':
        startDate = parseDate(getValue());
        break;
      case '--days':
        totalSpanDays = parsePositiveInt(getValue(), 'days');
        break;
      case '--chunkSize':
        chunkSizeDays = parsePositiveInt(getValue(), 'chunkSize');
        break;
      case '--forceRefresh':
        forceRefresh = parseBoolean(getValue(), 'forceRefresh');
        break;
      case '--no-force':
      case '--no-forceRefresh':
        forceRefresh = false;
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }

  return {
    sourceId,
    calendarId,
    baseUrl,
    startDate,
    totalSpanDays,
    chunkSizeDays,
    forceRefresh,
    listOnly,
  };
}

function parseDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return startOfDayInTimeZone(parsed, DEFAULT_TIME_ZONE);
}

function parsePositiveInt(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function parseBoolean(value: string, label: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n'].includes(normalized)) {
    return false;
  }
  throw new Error(`${label} must be true or false`);
}

function printUsage(): void {
  console.log(`Usage: ts-node src/scripts/fullIngest.ts [options]

Options:
  --list                       List configured sources and exit
  --sourceId <id>              Ingest only a matching source id
  --calendarId <calendar>      Ingest only a specific Google calendar id
  --baseUrl <url>              Ingest only a specific Tribe Events base URL
  --start <YYYY-MM-DD>         Override window start date (defaults to schedule lookback)
  --days <n>                   Total number of days to ingest from start
  --chunkSize <n>              Chunk size in days
  --forceRefresh <true|false>  Re-run classification/category assignment (default true)
  --no-force                   Shortcut for --forceRefresh=false
  --help                       Show this help message
`);
}

async function run(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));

  if (options.listOnly) {
    console.log('Configured sources:');
    COMMUNITY_EVENT_SOURCES.forEach(source => {
      const adapterId = getAdapterSourceId(source);
      const extra =
        source.kind === 'google-calendar'
          ? `calendarId=${source.calendarId}`
          : `baseUrl=${source.baseUrl}`;
      console.log(`- ${source.id} (${adapterId}) ${extra}`);
    });
    return;
  }

  const targets = selectSources({
    sourceId: options.sourceId ?? null,
    calendarId: options.calendarId ?? null,
    baseUrl: options.baseUrl ?? null,
  });

  if (targets.length === 0) {
    console.error('No matching sources found.');
    process.exit(1);
  }

  const chunkOptions: ChunkOptions = {
    forceRefresh: options.forceRefresh,
  };
  if (options.startDate) {
    chunkOptions.startDate = options.startDate;
  }
  if (typeof options.totalSpanDays === 'number') {
    chunkOptions.totalSpanDays = options.totalSpanDays;
  }
  if (typeof options.chunkSizeDays === 'number') {
    chunkOptions.chunkSizeDays = options.chunkSizeDays;
  }

  console.log(`Starting ingest for ${targets.length} source(s).`);
  console.log(`  forceRefresh: ${options.forceRefresh}`);
  if (options.startDate) {
    console.log(`  startDate: ${options.startDate.toISOString()}`);
  }
  if (typeof options.totalSpanDays === 'number') {
    console.log(`  totalSpanDays: ${options.totalSpanDays}`);
  }
  if (typeof options.chunkSizeDays === 'number') {
    console.log(`  chunkSizeDays: ${options.chunkSizeDays}`);
  }

  const aggregate: IngestStatsTotals = {
    fetched: 0,
    created: 0,
    updated: 0,
    skipped: 0,
  };

  for (const source of targets) {
    console.log(`\n[${source.id}] Starting ingest for ${getAdapterSourceId(source)}`);
    try {
      const stats = await ingestSourceInChunks(source, chunkOptions);
      console.log(
        `[${source.id}] Complete: fetched=${stats.fetched} created=${stats.created} updated=${stats.updated} skipped=${stats.skipped}`,
      );
      aggregate.fetched += stats.fetched;
      aggregate.created += stats.created;
      aggregate.updated += stats.updated;
      aggregate.skipped += stats.skipped;
    } catch (error) {
      console.error(`[${source.id}] Ingest failed`, error);
    }
  }

  console.log('\nAll ingests complete.');
  console.log(
    `Totals: fetched=${aggregate.fetched} created=${aggregate.created} updated=${aggregate.updated} skipped=${aggregate.skipped}`,
  );
}

interface IngestStatsTotals {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
}

run().then(
  () => process.exit(0),
  error => {
    console.error('Full ingest failed', error);
    process.exit(1);
  },
);
