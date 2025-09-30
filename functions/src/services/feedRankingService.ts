import { UserProfile, buildUserProfile } from './userProfileService';
import { ContentType } from '../models/interaction';

export interface ContentItem {
  id: string;
  title: string;
  contentType: ContentType;
  tags: string[];
  embedding: number[] | null;
  createdAt: Date;
  stats: {
    views?: number;
    likes?: number;
    shares?: number;
    bookmarks?: number;
  };
}

export interface RankedContentItem extends ContentItem {
  score: number;
  scoreBreakdown: {
    topicScore: number;
    contentTypeScore: number;
    timeScore: number;
    styleScore: number;
    recencyScore: number;
    popularityScore: number;
  };
  matchedTags?: string[];
}

export interface RankingWeights {
  topic: number;
  contentType: number;
  time: number;
  style: number;
  recency: number;
  popularity: number;
}

// Default weights (must sum to 1.0)
const DEFAULT_WEIGHTS: RankingWeights = {
  topic: 0.40,        // Embedding similarity
  contentType: 0.25,  // Content type preference
  time: 0.15,         // Time of day patterns
  style: 0.10,        // Engagement style match
  recency: 0.05,      // How fresh is content
  popularity: 0.05,   // Social proof
};

/**
 * Rank content items using multi-signal behavioral algorithm
 */
export async function rankContent(
  userId: string,
  candidates: ContentItem[],
  weights: RankingWeights = DEFAULT_WEIGHTS
): Promise<RankedContentItem[]> {
  // Build user profile from interactions
  const userProfile = await buildUserProfile(userId);

  // If user has no interaction history, return chronological
  if (userProfile.totalInteractions === 0 || !userProfile.embedding) {
    return candidates.map(item => ({
      ...item,
      score: getRecencyScore(item.createdAt),
      scoreBreakdown: {
        topicScore: 0,
        contentTypeScore: 0,
        timeScore: 0,
        styleScore: 0,
        recencyScore: getRecencyScore(item.createdAt),
        popularityScore: 0,
      },
    }));
  }

  // Score each content item
  const scored = candidates.map(item => {
    const breakdown = {
      topicScore: computeTopicScore(item, userProfile),
      contentTypeScore: computeContentTypeScore(item, userProfile),
      timeScore: computeTimeScore(item, userProfile),
      styleScore: computeStyleScore(item, userProfile),
      recencyScore: getRecencyScore(item.createdAt),
      popularityScore: getPopularityScore(item.stats),
    };

    const finalScore =
      weights.topic * breakdown.topicScore +
      weights.contentType * breakdown.contentTypeScore +
      weights.time * breakdown.timeScore +
      weights.style * breakdown.styleScore +
      weights.recency * breakdown.recencyScore +
      weights.popularity * breakdown.popularityScore;

    return {
      ...item,
      score: finalScore,
      scoreBreakdown: breakdown,
    };
  });

  // Sort by score descending
  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Apply exploration/exploitation mix
 * 80% top ranked items, 20% random exploration
 */
export function applyExplorationMix(
  rankedItems: RankedContentItem[],
  exploitRatio = 0.8
): RankedContentItem[] {
  const exploitCount = Math.floor(rankedItems.length * exploitRatio);
  const exploreCount = rankedItems.length - exploitCount;

  // Top items (exploitation)
  const topItems = rankedItems.slice(0, exploitCount);

  // Random sample from remaining (exploration)
  const remainingItems = rankedItems.slice(exploitCount);
  const exploreItems = shuffleArray(remainingItems).slice(0, exploreCount);

  // Shuffle the combined result
  return shuffleArray([...topItems, ...exploreItems]);
}

// ============================================
// SCORING FUNCTIONS
// ============================================

/**
 * Topic similarity score using embedding cosine similarity
 */
function computeTopicScore(item: ContentItem, profile: UserProfile): number {
  if (!item.embedding || !profile.embedding) {
    return 0;
  }

  return cosineSimilarity(item.embedding, profile.embedding);
}

/**
 * Content type preference score
 */
function computeContentTypeScore(item: ContentItem, profile: UserProfile): number {
  const affinity = profile.contentTypeAffinity[item.contentType];

  if (affinity === undefined) {
    return 0.5; // Neutral for unknown content types
  }

  // Map from [-1, 1] to [0, 1]
  return (affinity + 1) / 2;
}

/**
 * Time of day score - boost content posted during user's active times
 */
function computeTimeScore(item: ContentItem, profile: UserProfile): number {
  const currentHour = new Date().getHours();
  const currentTimeOfDay = getTimeOfDay(currentHour);

  const totalActivity = Object.values(profile.timeOfDayPatterns).reduce((sum, val) => sum + val, 0);

  if (totalActivity === 0) {
    return 0.5; // Neutral if no pattern
  }

  const activityAtThisTime = profile.timeOfDayPatterns[currentTimeOfDay];
  return activityAtThisTime / totalActivity;
}

/**
 * Engagement style match score
 * Boost long-form content for deep readers, snappy content for quick browsers
 */
function computeStyleScore(item: ContentItem, profile: UserProfile): number {
  // Estimate content length from title + description
  const estimatedLength = (item.title?.length || 0);

  if (profile.engagementStyle.isDeepReader) {
    // Deep readers prefer more substantial content
    return Math.min(estimatedLength / 200, 1);
  } else if (profile.engagementStyle.quickBrowser) {
    // Quick browsers prefer short, scannable content
    return Math.max(1 - estimatedLength / 200, 0);
  }

  return 0.5; // Neutral for average users
}

/**
 * Recency score - exponential decay
 */
function getRecencyScore(createdAt: Date): number {
  const now = new Date();
  const ageInHours = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);

  // Exponential decay: score = e^(-age/24)
  // Content is "fresh" for ~24 hours
  return Math.exp(-ageInHours / 24);
}

/**
 * Popularity score based on engagement stats
 */
function getPopularityScore(stats: ContentItem['stats']): number {
  const views = stats.views || 0;
  const engagement = (stats.likes || 0) + (stats.shares || 0) * 2 + (stats.bookmarks || 0) * 1.5;

  if (views === 0) {
    return 0;
  }

  // Engagement rate
  const rate = engagement / views;

  // Map to 0-1 scale (assuming 0.2 is excellent engagement)
  return Math.min(rate / 0.2, 1);
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function getTimeOfDay(hour: number): 'morning' | 'afternoon' | 'evening' | 'night' {
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 22) return 'evening';
  return 'night';
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
