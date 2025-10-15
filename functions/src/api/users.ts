import { Request, Response, Router } from 'express';
import {
  getPinnedEvents,
  setPinnedEventStatus,
  getPinnedEventEntry,
  PinnedEventsQueryOptions,
} from '../services/pinnedEventsService';

const router = Router();

function resolveCallerUserId(req: Request): string | undefined {
  const headerUserId = typeof req.headers['x-user-id'] === 'string'
    ? req.headers['x-user-id']
    : Array.isArray(req.headers['x-user-id'])
      ? req.headers['x-user-id'][0]
      : undefined;

  const bodyUserId = typeof (req.body?.userId) === 'string' ? req.body.userId : undefined;
  const queryUserId = typeof req.query.userId === 'string' ? req.query.userId : undefined;

  return headerUserId?.trim() || bodyUserId?.trim() || queryUserId?.trim();
}

function parseDateParam(value: unknown, fieldName: string): Date | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} must be an ISO date string`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} must be a valid ISO date string`);
  }

  return parsed;
}

function parseMode(value: unknown): 'today' | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'today') {
    return 'today';
  }
  throw new Error('mode must be "today" when provided');
}

function parsePageSize(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error('pageSize must be a positive integer');
  }
  return parsed;
}

router.get('/:userId/pinned-events', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.params.userId ?? '').trim();
    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    const callerUserId = resolveCallerUserId(req);
    if (callerUserId && callerUserId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const options: PinnedEventsQueryOptions = {};
    try {
      options.mode = parseMode(req.query.mode);
      if (!options.mode) {
        options.start = parseDateParam(req.query.start, 'start');
        options.end = parseDateParam(req.query.end, 'end');
      }
      options.pageSize = parsePageSize(req.query.pageSize);
      if (req.query.pageToken && typeof req.query.pageToken === 'string') {
        options.pageToken = req.query.pageToken;
      }
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid query parameters' });
      return;
    }

    const pinned = await getPinnedEvents(userId, options);
    res.json(pinned);
  } catch (error) {
    console.error('Failed to fetch pinned events', error);
    res.status(500).json({
      error: 'Failed to fetch pinned events',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

router.post('/:userId/pinned-events', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.params.userId ?? '').trim();
    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    const callerUserId = resolveCallerUserId(req);
    if (callerUserId && callerUserId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const { eventId, pinned } = req.body as {
      eventId?: unknown;
      pinned?: unknown;
    };

    if (typeof eventId !== 'string' || eventId.trim().length === 0) {
      res.status(400).json({ error: 'eventId is required and must be a string' });
      return;
    }

    if (pinned !== undefined && typeof pinned !== 'boolean') {
      res.status(400).json({ error: 'pinned must be a boolean when provided' });
      return;
    }

    const normalizedPinned = pinned ?? true;
    await setPinnedEventStatus(userId, eventId, normalizedPinned);

    const entry = normalizedPinned
      ? await getPinnedEventEntry(userId, eventId)
      : null;

    res.json({
      pinned: normalizedPinned,
      event: entry,
    });
  } catch (error) {
    console.error('Failed to update pinned events', error);
    res.status(500).json({
      error: 'Failed to update pinned events',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
