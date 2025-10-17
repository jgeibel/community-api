import express, { Request, Response } from 'express';
import cors from 'cors';
import { admin, firestore } from '../firebase/admin';
import { validateApiKey } from '../middleware/auth';
import { TagProposalRepository } from '../tags/proposalRepository';
import { addUtcDays, startOfDayInTimeZone } from '../utils/timezone';
import interactionRoutes from './interactions';
import mockRoutes from './mock/routes';
import { rankContent, applyExplorationMix, ContentItem } from '../services/feedRankingService';
import { hasEnoughDataForPersonalization } from '../services/userProfileService';
import userRoutes from './users';

const app = express();
const tagProposalRepository = new TagProposalRepository();
app.use(cors({ origin: true }));
app.use(express.json());

// Mount mock routes (no auth required for faster dev iteration)
app.use('/mock', mockRoutes);

// Apply auth to all other routes
app.use(validateApiKey);

// Mount interaction routes
app.use('/interactions', interactionRoutes);
app.use('/users', userRoutes);

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = firestore;
const DEFAULT_TIME_ZONE = 'America/Los_Angeles';

app.get('/status', (req, res) => {
  res.json({
    status: 'healthy',
    services: {
      eventIngestion: 'enabled',
    },
    timestamp: new Date().toISOString(),
  });
});

app.get('/feed', async (req: Request, res: Response): Promise<void> => {
  try {
    const now = new Date();
    now.setMilliseconds(0);

    const startParam = (req.query.start as string | undefined)?.trim();
    const daysParam = parseInt((req.query.days as string | undefined) ?? '1', 10);
    const pageSizeParam = parseInt((req.query.pageSize as string | undefined) ?? '20', 10);
    const pageToken = req.query.pageToken as string | undefined;
    const rawTags = (req.query.tags as string | undefined) ?? '';
    const tagsParam = rawTags
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0)
      .slice(0, 10);
    const userId = (req.query.userId as string | undefined)?.trim();

    const pageSize = Math.min(Math.max(pageSizeParam, 1), 50);
    const days = Math.min(Math.max(Number.isNaN(daysParam) ? 1 : daysParam, 1), 31);

    const startDateInput = startParam ? new Date(startParam) : new Date(now);
    if (Number.isNaN(startDateInput.getTime())) {
      res.status(400).json({ error: 'Invalid start date' });
      return;
    }
    const startDate = startOfDayInTimeZone(startDateInput, DEFAULT_TIME_ZONE);
    const endDateExclusive = addUtcDays(startDate, days);

    const startTs = admin.firestore.Timestamp.fromDate(startDate);
    const endTs = admin.firestore.Timestamp.fromDate(endDateExclusive);

    // Check if user has enough data for personalization
    const hasPersonalizationData = userId
      ? await hasEnoughDataForPersonalization(userId)
      : false;

    // Fetch candidate series (larger pool for ranking)
    const candidateLimit = hasPersonalizationData ? 500 : pageSize + 5;
    let query: FirebaseFirestore.Query = db
      .collection('eventSeries')
      .where('nextStartTime', '>=', startTs)
      .where('nextStartTime', '<', endTs)
      .limit(candidateLimit);

    if (tagsParam.length > 0) {
      query = query.where('tags', 'array-contains-any', tagsParam);
    }

    const snapshot = await query.get();

    const candidates: ContentItem[] = snapshot.docs.map(doc => {
      const data = doc.data();
      const series = mapSeriesForFeed(doc);
      const createdAt = resolveSeriesCreatedAt(data, series);

      return {
        id: doc.id,
        title: series.title ?? 'Untitled',
        contentType: 'event-series',
        tags: series.tags,
        embedding: extractVector(data.vector),
        createdAt,
        stats: sanitizeFeedStats(data.stats),
        metadata: {
          series,
        },
      };
    });

    // Use behavioral ranking if user has enough data
    let rankedCandidates;
    if (hasPersonalizationData && userId) {
      const ranked = await rankContent(userId, candidates);
      // Apply exploration/exploitation mix
      rankedCandidates = applyExplorationMix(ranked, 0.8);
    } else {
      // Sort chronologically by default
      rankedCandidates = candidates.sort((a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime()
      ).map(item => ({
        ...item,
        score: 0,
        scoreBreakdown: {
          topicScore: 0,
          contentTypeScore: 0,
          timeScore: 0,
          styleScore: 0,
          recencyScore: 0,
          popularityScore: 0,
        },
      }));
    }

    // Apply pagination
    const startIndex = pageToken ? parsePageOffset(pageToken) : 0;
    const paginatedItems = rankedCandidates.slice(startIndex, startIndex + pageSize);
    const hasMore = startIndex + pageSize < rankedCandidates.length;

    const events = paginatedItems.map(item => {
      const series = item.metadata?.series as FeedSeriesData | undefined;
      if (!series) {
        return null;
      }

      return {
        id: item.id,
        title: series.title,
        description: series.description,
        summary: series.summary,
        tags: series.tags,
        contentType: item.contentType,
        host: series.host,
        nextOccurrence: series.nextOccurrence,
        upcomingOccurrences: series.upcomingOccurrences,
        source: series.source,
        score: item.score,
        scoreBreakdown: item.scoreBreakdown,
      };
    }).filter(Boolean);

    res.json({
      count: events.length,
      events,
      nextPageToken: hasMore
        ? Buffer.from(String(startIndex + pageSize)).toString('base64')
        : null,
      window: {
        start: startDate.toISOString(),
        end: endDateExclusive.toISOString(),
      },
      personalized: hasPersonalizationData,
    });
  } catch (error) {
    console.error('Failed to fetch events', error);
    if (error instanceof Error && error.message === 'INVALID_PAGE_TOKEN') {
      res.status(400).json({ error: 'Invalid page token' });
    } else {
      res.status(500).json({
        error: 'Failed to fetch events',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
});

app.get('/tag-proposals', async (req: Request, res: Response): Promise<void> => {
  try {
    const limitParam = (req.query.limit as string | undefined)?.trim();
    const limitValue = limitParam ? Number.parseInt(limitParam, 10) : 20;
    const limit = Number.isNaN(limitValue) ? 20 : Math.min(Math.max(limitValue, 1), 100);

    const proposals = await tagProposalRepository.getTopProposals(limit);
    res.json({
      proposals,
      count: proposals.length,
    });
  } catch (error) {
    console.error('Failed to fetch tag proposals', error);
    res.status(500).json({ error: 'Failed to fetch tag proposals' });
  }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

function extractVector(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const filtered = value.filter(item => typeof item === 'number');
  if (filtered.length === 0) {
    return null;
  }
  return filtered as number[];
}

function parsePageOffset(token: string): number {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const offset = Number(decoded);
    if (Number.isNaN(offset) || offset < 0) {
      throw new Error('Invalid offset');
    }
    return offset;
  } catch (error) {
    console.warn('Invalid page token offset', error);
    throw new Error('INVALID_PAGE_TOKEN');
  }
}

type FeedSeriesOccurrence = {
  eventId: string;
  title: string | null;
  startTime: string;
  endTime: string | null;
  location: string | null;
  tags: string[];
};

type FeedSeriesHost = {
  id?: string | null;
  name?: string | null;
  organizer?: string | null;
  sourceIds?: string[];
} | null;

type FeedSeriesData = {
  id: string;
  title: string | null;
  description: string | null;
  summary: string | null;
  host: FeedSeriesHost;
  tags: string[];
  source: unknown;
  nextOccurrence: FeedSeriesOccurrence | null;
  upcomingOccurrences: FeedSeriesOccurrence[];
};

function mapSeriesForFeed(doc: FirebaseFirestore.QueryDocumentSnapshot): FeedSeriesData {
  const data = doc.data() ?? {};
  const upcomingOccurrences = Array.isArray(data.upcomingOccurrences)
    ? data.upcomingOccurrences
        .map(serializeSeriesOccurrence)
        .filter((occ): occ is FeedSeriesOccurrence => Boolean(occ))
    : [];
  const nextOccurrence = serializeSeriesOccurrence(data.nextOccurrence) ?? (upcomingOccurrences[0] ?? null);

  return {
    id: doc.id,
    title: typeof data.title === 'string' ? data.title : null,
    description: typeof data.description === 'string' ? data.description : null,
    summary: typeof data.summary === 'string' ? data.summary : null,
    host: sanitizeSeriesHost(data.host),
    tags: Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    source: data.source ?? null,
    nextOccurrence,
    upcomingOccurrences,
  };
}

function resolveSeriesCreatedAt(raw: Record<string, unknown>, series: FeedSeriesData): Date {
  const created = extractFirestoreTimestamp(raw.createdAt);
  if (created) {
    return created.toDate();
  }
  const updated = extractFirestoreTimestamp(raw.updatedAt);
  if (updated) {
    return updated.toDate();
  }

  if (series.nextOccurrence?.startTime) {
    const parsed = new Date(series.nextOccurrence.startTime);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
}

function sanitizeFeedStats(value: unknown): { views: number; likes: number; shares: number; bookmarks: number } {
  if (!value || typeof value !== 'object') {
    return { views: 0, likes: 0, shares: 0, bookmarks: 0 };
  }

  const stats = value as Record<string, unknown>;
  return {
    views: typeof stats.views === 'number' ? stats.views : 0,
    likes: typeof stats.likes === 'number' ? stats.likes : 0,
    shares: typeof stats.shares === 'number' ? stats.shares : 0,
    bookmarks: typeof stats.bookmarks === 'number' ? stats.bookmarks : 0,
  };
}

function sanitizeSeriesHost(value: unknown): FeedSeriesHost {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const host = value as {
    id?: unknown;
    name?: unknown;
    organizer?: unknown;
    sourceIds?: unknown;
  };

  const sourceIds = Array.isArray(host.sourceIds)
    ? host.sourceIds.filter((item): item is string => typeof item === 'string')
    : [];

  return {
    id: typeof host.id === 'string' ? host.id : null,
    name: typeof host.name === 'string' ? host.name : null,
    organizer: typeof host.organizer === 'string' ? host.organizer : null,
    sourceIds,
  };
}

function serializeSeriesOccurrence(value: unknown): FeedSeriesOccurrence | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const occurrence = value as {
    eventId?: unknown;
    title?: unknown;
    startTime?: unknown;
    endTime?: unknown;
    location?: unknown;
    tags?: unknown;
  };

  if (typeof occurrence.eventId !== 'string') {
    return null;
  }

  const startTs = extractFirestoreTimestamp(occurrence.startTime);
  if (!startTs) {
    return null;
  }

  const endTs = extractFirestoreTimestamp(occurrence.endTime);
  const tags = Array.isArray(occurrence.tags)
    ? occurrence.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];

  return {
    eventId: occurrence.eventId,
    title: typeof occurrence.title === 'string' ? occurrence.title : null,
    startTime: startTs.toDate().toISOString(),
    endTime: endTs ? endTs.toDate().toISOString() : null,
    location: typeof occurrence.location === 'string' ? occurrence.location : null,
    tags,
  };
}

function extractFirestoreTimestamp(value: unknown): admin.firestore.Timestamp | null {
  if (!value) {
    return null;
  }

  if (value instanceof admin.firestore.Timestamp) {
    return value;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toDate?: () => Date }).toDate === 'function'
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    return admin.firestore.Timestamp.fromDate(date);
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return admin.firestore.Timestamp.fromDate(parsed);
    }
  }

  return null;
}

export default app;
