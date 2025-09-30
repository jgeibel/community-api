import express, { Request, Response } from 'express';
import { MOCK_CONTENT } from './fixtures';
import { isMockPersona, getPersonaProfile } from './personas';
import { rankMockContent, applyExplorationMix } from './rankingEngine';
import { hasEnoughDataForPersonalization } from '../../services/userProfileService';
import { rankContent, applyExplorationMix as applyRealExplorationMix } from '../../services/feedRankingService';
import { firestore } from '../../firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';

const router = express.Router();
const db = firestore;

/**
 * GET /mock/feed
 * Returns mock content with two modes:
 * 1. Mock personas (userId starts with 'mock-') → in-memory ranking, no DB
 * 2. Real users → fetch profile from DB, rank mock content (hybrid mode)
 * 3. No userId → chronological mock content
 */
router.get('/feed', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.query.userId as string | undefined)?.trim();
    const pageSizeParam = parseInt((req.query.pageSize as string | undefined) ?? '20', 10);
    const pageToken = req.query.pageToken as string | undefined;
    const rawTags = (req.query.tags as string | undefined) ?? '';

    const pageSize = Math.min(Math.max(pageSizeParam, 1), 50);

    // Parse tag filter
    const tagsParam = rawTags
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0)
      .slice(0, 10);

    // Filter by tags if provided
    let filteredContent = MOCK_CONTENT;
    if (tagsParam.length > 0) {
      filteredContent = MOCK_CONTENT.filter(item =>
        item.tags.some(tag => tagsParam.includes(tag))
      );
    }

    // Mode 1: Mock Persona (pure mock, no DB)
    if (userId && isMockPersona(userId)) {
      const personaProfile = getPersonaProfile(userId);

      if (!personaProfile) {
        res.status(400).json({ error: 'Unknown mock persona' });
        return;
      }

      // Rank using in-memory engine
      const ranked = rankMockContent(personaProfile, filteredContent);
      const mixed = applyExplorationMix(ranked, 0.8);

      // Paginate
      const startIndex = pageToken ? parsePageOffset(pageToken) : 0;
      const paginatedItems = mixed.slice(startIndex, startIndex + pageSize);
      const hasMore = startIndex + pageSize < mixed.length;

      res.json({
        count: paginatedItems.length,
        events: paginatedItems.map(item => ({
          id: item.id,
          title: item.title,
          description: item.description,
          contentType: item.contentType,
          startTime: item.startTime,
          endTime: item.endTime,
          tags: item.tags,
          score: item.score,
          source: item.source,
        })),
        nextPageToken: hasMore
          ? Buffer.from(String(startIndex + pageSize)).toString('base64')
          : null,
        personalized: true,
        mode: 'mock-persona',
      });
      return;
    }

    // Mode 2: Real user with mock content (hybrid mode)
    if (userId) {
      const hasProfile = await hasEnoughDataForPersonalization(userId);

      if (hasProfile) {
        // Convert mock items to ContentItem format for real ranking
        const candidates = filteredContent.map(item => ({
          id: item.id,
          title: item.title,
          contentType: item.contentType,
          tags: item.tags,
          embedding: item.embedding,
          createdAt: item.createdAt,
          stats: item.stats,
        }));

        // Use REAL ranking algorithm with user's actual profile
        const ranked = await rankContent(userId, candidates);
        const mixed = applyRealExplorationMix(ranked, 0.8);

        // Paginate
        const startIndex = pageToken ? parsePageOffset(pageToken) : 0;
        const paginatedItems = mixed.slice(startIndex, startIndex + pageSize);
        const hasMore = startIndex + pageSize < mixed.length;

        // Map back to response format
        const events = paginatedItems.map(item => {
          const mockItem = filteredContent.find(m => m.id === item.id);
          return {
            id: item.id,
            title: item.title,
            description: mockItem?.description,
            contentType: item.contentType,
            startTime: mockItem?.startTime,
            endTime: mockItem?.endTime,
            tags: item.tags,
            score: item.score,
            source: mockItem?.source || { sourceId: 'mock', sourceEventId: item.id },
          };
        });

        res.json({
          count: events.length,
          events,
          nextPageToken: hasMore
            ? Buffer.from(String(startIndex + pageSize)).toString('base64')
            : null,
          personalized: true,
          mode: 'hybrid',
        });
        return;
      }
    }

    // Mode 3: No user or new user → chronological
    const sorted = [...filteredContent].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );

    const startIndex = pageToken ? parsePageOffset(pageToken) : 0;
    const paginatedItems = sorted.slice(startIndex, startIndex + pageSize);
    const hasMore = startIndex + pageSize < sorted.length;

    res.json({
      count: paginatedItems.length,
      events: paginatedItems.map(item => ({
        id: item.id,
        title: item.title,
        description: item.description,
        contentType: item.contentType,
        startTime: item.startTime,
        endTime: item.endTime,
        tags: item.tags,
        score: 0,
        source: item.source,
      })),
      nextPageToken: hasMore
        ? Buffer.from(String(startIndex + pageSize)).toString('base64')
        : null,
      personalized: false,
      mode: 'chronological',
    });
  } catch (error) {
    console.error('Mock feed error:', error);
    res.status(500).json({
      error: 'Failed to fetch mock feed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /mock/interactions
 * Records interactions:
 * - Mock personas: no-op (returns success)
 * - Real users: writes to actual Firestore
 */
router.post('/interactions', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, contentId, contentType, action, dwellTime, context, contentTags } = req.body;

    // Basic validation
    if (!userId || !contentId || !action) {
      res.status(400).json({ error: 'Missing required fields: userId, contentId, action' });
      return;
    }

    // Mock persona: no-op
    if (isMockPersona(userId)) {
      res.status(201).json({
        success: true,
        interactionId: `mock-${Date.now()}`,
        mode: 'mock-persona',
      });
      return;
    }

    // Real user: write to Firestore
    const interaction: any = {
      userId,
      contentId,
      contentType: contentType || 'event',
      action,
      timestamp: new Date().toISOString(),
      context: context || {
        position: 0,
        sessionId: `session-${Date.now()}`,
        timeOfDay: getTimeOfDay(new Date().getHours()),
        dayOfWeek: getDayOfWeek(new Date().getDay()),
      },
      contentTags: contentTags || [],
    };

    if (dwellTime !== undefined) {
      interaction.dwellTime = dwellTime;
    }

    const docRef = await db.collection('interactions').add({
      ...interaction,
      createdAt: FieldValue.serverTimestamp(),
    });

    res.status(201).json({
      success: true,
      interactionId: docRef.id,
      mode: 'hybrid',
    });
  } catch (error) {
    console.error('Mock interaction error:', error);
    res.status(500).json({
      error: 'Failed to record interaction',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /mock/interactions/batch
 * Batch record interactions
 */
router.post('/interactions/batch', async (req: Request, res: Response): Promise<void> => {
  try {
    const { interactions } = req.body as { interactions: any[] };

    if (!Array.isArray(interactions) || interactions.length === 0) {
      res.status(400).json({ error: 'interactions must be a non-empty array' });
      return;
    }

    if (interactions.length > 100) {
      res.status(400).json({ error: 'Maximum 100 interactions per batch' });
      return;
    }

    // Check if all are mock personas
    const allMock = interactions.every(i => isMockPersona(i.userId));

    if (allMock) {
      // All mock personas: no-op
      res.status(201).json({
        success: true,
        count: interactions.length,
        interactionIds: interactions.map((_, i) => `mock-batch-${Date.now()}-${i}`),
        mode: 'mock-persona',
      });
      return;
    }

    // Contains real users: write to Firestore
    const batch = db.batch();
    const interactionIds: string[] = [];

    for (const input of interactions) {
      if (!input.userId || !input.contentId || !input.action) {
        continue;
      }

      // Skip mock personas in batch
      if (isMockPersona(input.userId)) {
        interactionIds.push(`mock-${Date.now()}`);
        continue;
      }

      const docRef = db.collection('interactions').doc();
      interactionIds.push(docRef.id);

      const interaction: any = {
        userId: input.userId,
        contentId: input.contentId,
        contentType: input.contentType || 'event',
        action: input.action,
        timestamp: new Date().toISOString(),
        context: input.context || {
          position: 0,
          sessionId: `session-${Date.now()}`,
          timeOfDay: getTimeOfDay(new Date().getHours()),
          dayOfWeek: getDayOfWeek(new Date().getDay()),
        },
        contentTags: input.contentTags || [],
      };

      if (input.dwellTime !== undefined) {
        interaction.dwellTime = input.dwellTime;
      }

      batch.set(docRef, {
        ...interaction,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();

    res.status(201).json({
      success: true,
      count: interactionIds.length,
      interactionIds,
      mode: 'hybrid',
    });
  } catch (error) {
    console.error('Mock batch interaction error:', error);
    res.status(500).json({
      error: 'Failed to record batch interactions',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /mock/status
 * Health check for mock API
 */
router.get('/status', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    mode: 'mock',
    contentItems: MOCK_CONTENT.length,
    timestamp: new Date().toISOString(),
  });
});

// Helper functions
function parsePageOffset(token: string): number {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const offset = Number(decoded);
    if (Number.isNaN(offset) || offset < 0) {
      throw new Error('Invalid offset');
    }
    return offset;
  } catch (error) {
    throw new Error('INVALID_PAGE_TOKEN');
  }
}

function getTimeOfDay(hour: number): 'morning' | 'afternoon' | 'evening' | 'night' {
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 22) return 'evening';
  return 'night';
}

function getDayOfWeek(day: number): 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday' {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
  return days[day];
}

export default router;
