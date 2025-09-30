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
import { ContentType } from '../models/interaction';

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

    // Fetch candidate events (larger pool for ranking)
    const candidateLimit = hasPersonalizationData ? 500 : pageSize + 1;
    let query: FirebaseFirestore.Query = db
      .collection('events')
      .where('startTime', '>=', startTs)
      .where('startTime', '<', endTs)
      .limit(candidateLimit);

    if (tagsParam.length > 0) {
      query = query.where('tags', 'array-contains-any', tagsParam);
    }

    const snapshot = await query.get();

    // Convert to ContentItem format
    const candidates: ContentItem[] = snapshot.docs.map(doc => {
      const data = doc.data();

      // Safely parse createdAt
      let createdAt = new Date();
      if (data.createdAt?.toDate) {
        createdAt = data.createdAt.toDate();
      } else if (data.lastFetchedAt) {
        const parsed = new Date(data.lastFetchedAt);
        if (!isNaN(parsed.getTime())) {
          createdAt = parsed;
        }
      }

      return {
        id: doc.id,
        title: data.title || 'Untitled',
        contentType: (data.contentType as ContentType) || 'event',
        tags: Array.isArray(data.tags) ? data.tags : [],
        embedding: extractVector(data.vector),
        createdAt,
        stats: {
          views: data.stats?.views || 0,
          likes: data.stats?.likes || 0,
          shares: data.stats?.shares || 0,
          bookmarks: data.stats?.bookmarks || 0,
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

    // Fetch full event data for paginated items
    const eventDocs = await Promise.all(
      paginatedItems.map(item => db.collection('events').doc(item.id).get())
    );

    // Map to API response format
    const events = eventDocs.map((doc, idx) => {
      const data = doc.data();
      if (!data) return null;

      const item = paginatedItems[idx];
      const start = data.startTime?.toDate ? data.startTime.toDate().toISOString() : data.startTime;
      const end = data.endTime?.toDate ? data.endTime.toDate().toISOString() : data.endTime;

      return {
        id: doc.id,
        title: data.title,
        startTime: start,
        endTime: end,
        tags: Array.isArray(data.tags) ? data.tags : [],
        contentType: item.contentType,
        score: item.score,
        source: data.source ?? null,
        classification: data.classification ?? null,
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

export default app;
