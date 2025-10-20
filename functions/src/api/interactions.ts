import { Request, Response, Router } from 'express';
import { firestore } from '../firebase/admin';
import { CreateInteractionInput, InteractionAction, ContentType } from '../models/interaction';
import { FieldValue } from 'firebase-admin/firestore';
import { applyPinToggle } from '../services/pinnedEventsService';
import { CategoryBundleStateService } from '../services/categoryBundleStateService';

const router = Router();
const db = firestore;
const categoryBundleStateService = new CategoryBundleStateService();

// Valid action types for validation
const VALID_ACTIONS: InteractionAction[] = [
  'viewed', 'liked', 'shared', 'bookmarked', 'dismissed',
  'not-interested', 'attended', 'engaged', 'commented'
];

const VALID_CONTENT_TYPES: ContentType[] = [
  'event',
  'event-series',
  'event-category-bundle',
  'flash-offer',
  'poll',
  'request',
  'photo',
  'announcement',
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

    if ((input.contentType === 'event' || input.contentType === 'event-series') && input.action === 'bookmarked') {
      await applyPinToggle(input.userId, input.contentId, input.contentType, input.metadata);
    }

    if (input.contentType === 'event-category-bundle') {
      let bundleState: BundleState;
      try {
        bundleState = requireBundleState(input.metadata);
      } catch (error) {
        if (error instanceof BundleStateValidationError) {
          res.status(400).json({
            error: 'Invalid bundle metadata',
            message: error.message,
          });
          return;
        }
        throw error;
      }

      await categoryBundleStateService.markSeen(input.userId, bundleState.categoryId, bundleState.version);
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
    const pinUpdates: Array<{ userId: string; contentId: string; contentType: ContentType; metadata?: Record<string, unknown> }> = [];
    const bundleUpdates: Array<{ userId: string; categoryId: string; version: number }> = [];

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

      if ((input.contentType === 'event' || input.contentType === 'event-series') && input.action === 'bookmarked') {
        pinUpdates.push({
          userId: input.userId,
          contentId: input.contentId,
          contentType: input.contentType,
          metadata: input.metadata,
        });
      }

      if (input.contentType === 'event-category-bundle') {
        let bundleState: BundleState;
        try {
          bundleState = requireBundleState(input.metadata);
        } catch (error) {
          if (error instanceof BundleStateValidationError) {
            throw error;
          }
          throw error;
        }

        bundleUpdates.push({
          userId: input.userId,
          categoryId: bundleState.categoryId,
          version: bundleState.version,
        });
      }
    }

    await batch.commit();
    if (pinUpdates.length > 0) {
      await Promise.all(pinUpdates.map(update => applyPinToggle(
        update.userId,
        update.contentId,
        update.contentType ?? 'event',
        update.metadata,
      )));
    }
    if (bundleUpdates.length > 0) {
      await Promise.all(bundleUpdates.map(update =>
        categoryBundleStateService.markSeen(update.userId, update.categoryId, update.version)
      ));
    }

    res.status(201).json({
      success: true,
      count: interactionIds.length,
      interactionIds,
    });
  } catch (error) {
    if (error instanceof BundleStateValidationError) {
      res.status(400).json({
        error: 'Invalid bundle metadata',
        message: error.message,
      });
      return;
    }

    console.error('Failed to record batch interactions', error);
    res.status(500).json({
      error: 'Failed to record batch interactions',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface BundleState {
  categoryId: string;
  version: number;
}

class BundleStateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BundleStateValidationError';
  }
}

function requireBundleState(metadata: unknown): BundleState {
  if (!isRecord(metadata)) {
    throw new BundleStateValidationError('metadata.bundleState must be provided for event-category-bundle interactions');
  }

  const state = metadata.bundleState;
  if (!isRecord(state)) {
    throw new BundleStateValidationError('metadata.bundleState must be an object with categoryId and version');
  }

  const categoryIdRaw = state.categoryId;
  if (typeof categoryIdRaw !== 'string' || categoryIdRaw.trim().length === 0) {
    throw new BundleStateValidationError('metadata.bundleState.categoryId must be a non-empty string');
  }

  const versionRaw = state.version;
  if (typeof versionRaw !== 'number' || !Number.isFinite(versionRaw)) {
    throw new BundleStateValidationError('metadata.bundleState.version must be a finite number');
  }

  if (versionRaw < 0) {
    throw new BundleStateValidationError('metadata.bundleState.version must be >= 0');
  }

  return {
    categoryId: categoryIdRaw.trim(),
    version: versionRaw,
  };
}
