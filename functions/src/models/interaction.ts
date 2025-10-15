export type ContentType = 'event' | 'flash-offer' | 'poll' | 'request' | 'photo' | 'announcement';

export type InteractionAction =
  | 'viewed'
  | 'liked'
  | 'shared'
  | 'bookmarked'
  | 'dismissed'
  | 'not-interested'
  | 'attended'
  | 'engaged'
  | 'commented';

export interface InteractionContext {
  position: number;
  sessionId: string;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  dayOfWeek: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
}

export interface Interaction {
  id?: string;
  userId: string;
  contentId: string;
  contentType: ContentType;
  action: InteractionAction;
  dwellTime?: number; // Seconds spent viewing
  timestamp: string; // ISO string
  context: InteractionContext;
  contentTags: string[]; // Denormalized for fast lookup
  metadata?: Record<string, unknown>;
}

export interface CreateInteractionInput {
  userId: string;
  contentId: string;
  contentType: ContentType;
  action: InteractionAction;
  dwellTime?: number;
  context: InteractionContext;
  contentTags?: string[];
  metadata?: Record<string, unknown>;
}

// Action weights for computing affinity scores
export const ACTION_WEIGHTS: Record<InteractionAction, number> = {
  'viewed': 0.1,
  'liked': 3,
  'shared': 5,
  'bookmarked': 4,
  'dismissed': -2,
  'not-interested': -5,
  'attended': 10,
  'engaged': 4,
  'commented': 4,
};
