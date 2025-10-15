import { Request, Response, Router } from 'express';
import { firestore } from '../firebase/admin';
import { CreateInteractionInput, InteractionAction, ContentType } from '../models/interaction';
import { FieldValue } from 'firebase-admin/firestore';
import { applyPinToggle } from '../services/pinnedEventsService';

const router = Router();
const db = firestore;

// Valid action types for validation
const VALID_ACTIONS: InteractionAction[] = [
  'viewed', 'liked', 'shared', 'bookmarked', 'dismissed',
  'not-interested', 'attended', 'engaged', 'commented'
];

const VALID_CONTENT_TYPES: ContentType[] = [
  'event', 'flash-offer', 'poll', 'request', 'photo', 'announcement'
];

const VALID_TIME_OF_DAY = ['morning', 'afternoon', 'evening', 'night'] as const;
const VALID_DAY_OF_WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

/**
 * POST /api/interactions
 * Record a user interaction with content
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const input = req.body as CreateInteractionInput;

    // Validation
    if (!input.userId || typeof input.userId !== 'string') {
      res.status(400).json({ error: 'userId is required and must be a string' });
      return;
    }

    if (!input.contentId || typeof input.contentId !== 'string') {
      res.status(400).json({ error: 'contentId is required and must be a string' });
      return;
    }

    if (!VALID_CONTENT_TYPES.includes(input.contentType)) {
      res.status(400).json({
        error: `contentType must be one of: ${VALID_CONTENT_TYPES.join(', ')}`
      });
      return;
    }

    if (!VALID_ACTIONS.includes(input.action)) {
      res.status(400).json({
        error: `action must be one of: ${VALID_ACTIONS.join(', ')}`
      });
      return;
    }

    if (input.dwellTime !== undefined && (typeof input.dwellTime !== 'number' || input.dwellTime < 0)) {
      res.status(400).json({ error: 'dwellTime must be a positive number' });
      return;
    }

    if (!input.context || typeof input.context !== 'object') {
      res.status(400).json({ error: 'context is required' });
      return;
    }

    if (typeof input.context.position !== 'number' || input.context.position < 0) {
      res.status(400).json({ error: 'context.position must be a non-negative number' });
      return;
    }

    if (!input.context.sessionId || typeof input.context.sessionId !== 'string') {
      res.status(400).json({ error: 'context.sessionId is required' });
      return;
    }

    if (!VALID_TIME_OF_DAY.includes(input.context.timeOfDay as any)) {
      res.status(400).json({
        error: `context.timeOfDay must be one of: ${VALID_TIME_OF_DAY.join(', ')}`
      });
      return;
    }

    if (!VALID_DAY_OF_WEEK.includes(input.context.dayOfWeek as any)) {
      res.status(400).json({
        error: `context.dayOfWeek must be one of: ${VALID_DAY_OF_WEEK.join(', ')}`
      });
      return;
    }

    if (input.metadata !== undefined) {
      if (typeof input.metadata !== 'object' || input.metadata === null || Array.isArray(input.metadata)) {
        res.status(400).json({ error: 'metadata must be an object when provided' });
        return;
      }
    }

    // Fetch content tags if not provided
    let contentTags = input.contentTags || [];
    if (contentTags.length === 0) {
      try {
        const contentDoc = await db.collection('events').doc(input.contentId).get();
        if (contentDoc.exists) {
          contentTags = contentDoc.data()?.tags || [];
        }
      } catch (error) {
        console.warn('Failed to fetch content tags', error);
      }
    }

    // Create interaction document
    const interaction: any = {
      userId: input.userId,
      contentId: input.contentId,
      contentType: input.contentType,
      action: input.action,
      timestamp: new Date().toISOString(),
      context: input.context,
      contentTags,
    };

    // Only include dwellTime if provided
    if (input.dwellTime !== undefined) {
      interaction.dwellTime = input.dwellTime;
    }

    if (input.metadata !== undefined) {
      interaction.metadata = input.metadata;
    }

    const docRef = await db.collection('interactions').add({
      ...interaction,
      createdAt: FieldValue.serverTimestamp(),
    });

    if (input.contentType === 'event' && input.action === 'bookmarked') {
      await applyPinToggle(input.userId, input.contentId, input.metadata);
    }

    res.status(201).json({
      success: true,
      interactionId: docRef.id,
    });
  } catch (error) {
    console.error('Failed to record interaction', error);
    res.status(500).json({
      error: 'Failed to record interaction',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/interactions/batch
 * Record multiple interactions at once (for performance)
 */
router.post('/batch', async (req: Request, res: Response): Promise<void> => {
  try {
    const { interactions } = req.body as { interactions: CreateInteractionInput[] };

    if (!Array.isArray(interactions) || interactions.length === 0) {
      res.status(400).json({ error: 'interactions must be a non-empty array' });
      return;
    }

    if (interactions.length > 100) {
      res.status(400).json({ error: 'Maximum 100 interactions per batch' });
      return;
    }

    const batch = db.batch();
    const interactionIds: string[] = [];
    const pinUpdates: Array<{ userId: string; contentId: string; metadata?: Record<string, unknown> }> = [];

    for (const input of interactions) {
      // Basic validation (skip detailed validation for performance)
      if (!input.userId || !input.contentId || !input.action) {
        continue;
      }

      const docRef = db.collection('interactions').doc();
      interactionIds.push(docRef.id);

      const interaction: any = {
        userId: input.userId,
        contentId: input.contentId,
        contentType: input.contentType,
        action: input.action,
        timestamp: new Date().toISOString(),
        context: input.context,
        contentTags: input.contentTags || [],
      };

      // Only include dwellTime if provided
      if (input.dwellTime !== undefined) {
        interaction.dwellTime = input.dwellTime;
      }

      if (input.metadata !== undefined) {
        interaction.metadata = input.metadata;
      }

      batch.set(docRef, {
        ...interaction,
        createdAt: FieldValue.serverTimestamp(),
      });

      if (input.contentType === 'event' && input.action === 'bookmarked') {
        pinUpdates.push({
          userId: input.userId,
          contentId: input.contentId,
          metadata: input.metadata,
        });
      }
    }

    await batch.commit();
    if (pinUpdates.length > 0) {
      await Promise.all(pinUpdates.map(update => applyPinToggle(
        update.userId,
        update.contentId,
        update.metadata,
      )));
    }

    res.status(201).json({
      success: true,
      count: interactionIds.length,
      interactionIds,
    });
  } catch (error) {
    console.error('Failed to record batch interactions', error);
    res.status(500).json({
      error: 'Failed to record batch interactions',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
