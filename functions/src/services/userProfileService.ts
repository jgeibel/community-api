import { firestore } from '../firebase/admin';
import { ACTION_WEIGHTS, ContentType, InteractionAction } from '../models/interaction';

const db = firestore;

export interface ContentTypeAffinity {
  [contentType: string]: number; // Score from -1 to 1
}

export interface TimeOfDayPatterns {
  morning: number;
  afternoon: number;
  evening: number;
  night: number;
}

export interface EngagementStyle {
  isDeepReader: boolean;
  scrollsDeep: boolean;
  quickBrowser: boolean;
  avgDwellTime: number;
  avgPosition: number;
}

export interface UserProfile {
  userId: string;
  embedding: number[] | null;
  contentTypeAffinity: ContentTypeAffinity;
  timeOfDayPatterns: TimeOfDayPatterns;
  engagementStyle: EngagementStyle;
  totalInteractions: number;
  lastActiveAt: string | null;
}

/**
 * Build a complete user profile from their interaction history
 */
export async function buildUserProfile(userId: string): Promise<UserProfile> {
  const interactions = await getRecentInteractions(userId, 200);

  return {
    userId,
    embedding: await getUserEmbedding(userId, interactions),
    contentTypeAffinity: computeContentTypeAffinity(interactions),
    timeOfDayPatterns: computeTimeOfDayPatterns(interactions),
    engagementStyle: computeEngagementStyle(interactions),
    totalInteractions: interactions.length,
    lastActiveAt: interactions.length > 0 ? interactions[0].timestamp : null,
  };
}

/**
 * Get user embedding by averaging embeddings of content they liked
 */
export async function getUserEmbedding(
  userId: string,
  interactions?: InteractionData[]
): Promise<number[] | null> {
  const userInteractions = interactions || await getRecentInteractions(userId, 50);

  // Filter for positive interactions only
  const positiveInteractions = userInteractions.filter(i =>
    ['liked', 'bookmarked', 'shared', 'attended', 'engaged'].includes(i.action)
  );

  if (positiveInteractions.length === 0) {
    return null;
  }

  // Fetch embeddings for liked content
  const embeddings: number[][] = [];
  const contentIds = positiveInteractions.map(i => i.contentId);

  // Batch fetch content documents
  const chunks = chunkArray(contentIds, 10); // Firestore limit
  for (const chunk of chunks) {
    const docs = await db.getAll(...chunk.map(id => db.collection('events').doc(id)));
    for (const doc of docs) {
      if (doc.exists) {
        const vector = doc.data()?.vector;
        if (Array.isArray(vector) && vector.length > 0) {
          embeddings.push(vector);
        }
      }
    }
  }

  if (embeddings.length === 0) {
    return null;
  }

  // Average all embeddings
  return averageVectors(embeddings);
}

/**
 * Compute user's affinity for different content types
 * Returns scores from -1 (dislikes) to +1 (loves)
 */
export function computeContentTypeAffinity(interactions: InteractionData[]): ContentTypeAffinity {
  const typeScores: Record<string, { positive: number; total: number }> = {};

  for (const interaction of interactions) {
    const contentType = interaction.contentType;

    if (!typeScores[contentType]) {
      typeScores[contentType] = { positive: 0, total: 0 };
    }

    typeScores[contentType].total += 1;

    const weight = ACTION_WEIGHTS[interaction.action] || 0;
    typeScores[contentType].positive += weight;
  }

  // Normalize to -1 to +1 scale
  const affinity: ContentTypeAffinity = {};
  for (const [type, { positive, total }] of Object.entries(typeScores)) {
    if (total > 0) {
      // Normalize by total interactions to get average score
      affinity[type] = clamp(positive / total / 10, -1, 1); // Divide by 10 to scale ACTION_WEIGHTS
    }
  }

  return affinity;
}

/**
 * Compute when user is most active
 */
export function computeTimeOfDayPatterns(interactions: InteractionData[]): TimeOfDayPatterns {
  const patterns: TimeOfDayPatterns = {
    morning: 0,
    afternoon: 0,
    evening: 0,
    night: 0,
  };

  for (const interaction of interactions) {
    const timeOfDay = interaction.context?.timeOfDay;
    if (timeOfDay && timeOfDay in patterns) {
      patterns[timeOfDay] += 1;
    }
  }

  return patterns;
}

/**
 * Compute user's engagement style
 */
export function computeEngagementStyle(interactions: InteractionData[]): EngagementStyle {
  if (interactions.length === 0) {
    return {
      isDeepReader: false,
      scrollsDeep: false,
      quickBrowser: true,
      avgDwellTime: 0,
      avgPosition: 0,
    };
  }

  const dwellTimes = interactions
    .map(i => i.dwellTime || 0)
    .filter(t => t > 0);

  const positions = interactions
    .map(i => i.context?.position || 0)
    .filter(p => p > 0);

  const avgDwellTime = dwellTimes.length > 0
    ? dwellTimes.reduce((sum, t) => sum + t, 0) / dwellTimes.length
    : 0;

  const avgPosition = positions.length > 0
    ? positions.reduce((sum, p) => sum + p, 0) / positions.length
    : 0;

  return {
    isDeepReader: avgDwellTime > 10,
    scrollsDeep: avgPosition > 20,
    quickBrowser: avgDwellTime < 3,
    avgDwellTime,
    avgPosition,
  };
}

/**
 * Get user's tag affinity scores from interactions
 * Returns a map of tag -> affinity score (-1 to 1)
 */
export async function getUserTagAffinity(userId: string, limit = 100): Promise<Record<string, number>> {
  const interactions = await getRecentInteractions(userId, limit);

  const tagScores: Record<string, { positive: number; negative: number }> = {};

  for (const interaction of interactions) {
    const tags = interaction.contentTags || [];
    const weight = ACTION_WEIGHTS[interaction.action] || 0;

    for (const tag of tags) {
      if (!tagScores[tag]) {
        tagScores[tag] = { positive: 0, negative: 0 };
      }

      if (weight > 0) {
        tagScores[tag].positive += weight;
      } else {
        tagScores[tag].negative += Math.abs(weight);
      }
    }
  }

  // Normalize to -1 to +1 scale
  const affinity: Record<string, number> = {};
  for (const [tag, { positive, negative }] of Object.entries(tagScores)) {
    const total = positive + negative;
    if (total > 0) {
      affinity[tag] = (positive - negative) / (positive + negative + 1);
    }
  }

  return affinity;
}

/**
 * Check if user has enough interaction history for personalization
 */
export async function hasEnoughDataForPersonalization(userId: string): Promise<boolean> {
  const snapshot = await db.collection('interactions')
    .where('userId', '==', userId)
    .limit(20)
    .get();

  return snapshot.size >= 20;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

interface InteractionData {
  contentId: string;
  contentType: ContentType;
  action: InteractionAction;
  dwellTime?: number;
  timestamp: string;
  context?: {
    position?: number;
    timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night';
    dayOfWeek?: string;
  };
  contentTags?: string[];
}

async function getRecentInteractions(userId: string, limit: number): Promise<InteractionData[]> {
  const snapshot = await db.collection('interactions')
    .where('userId', '==', userId)
    .orderBy('timestamp', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      contentId: data.contentId,
      contentType: data.contentType,
      action: data.action,
      dwellTime: data.dwellTime,
      timestamp: data.timestamp,
      context: data.context,
      contentTags: data.contentTags || [],
    };
  });
}

function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) {
    return [];
  }

  const dimension = vectors[0].length;
  const sum = new Array(dimension).fill(0);

  for (const vector of vectors) {
    for (let i = 0; i < dimension; i++) {
      sum[i] += vector[i];
    }
  }

  return sum.map(val => val / vectors.length);
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (magnitude === 0) return vector;
  return vector.map(val => val / magnitude);
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export { normalizeVector };
