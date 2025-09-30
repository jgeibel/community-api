import { UserProfile } from '../../services/userProfileService';
import { MockFeedItem } from './fixtures';

export interface RankedMockItem extends MockFeedItem {
  score: number;
  scoreBreakdown: {
    topicScore: number;
    contentTypeScore: number;
    timeScore: number;
    styleScore: number;
    recencyScore: number;
    popularityScore: number;
  };
}

interface RankingWeights {
  topic: number;
  contentType: number;
  time: number;
  style: number;
  recency: number;
  popularity: number;
}

const DEFAULT_WEIGHTS: RankingWeights = {
  topic: 0.40,
  contentType: 0.25,
  time: 0.15,
  style: 0.10,
  recency: 0.05,
  popularity: 0.05,
};

/**
 * Simplified in-memory ranking for mock personas
 * Same logic as real ranking but without DB calls
 */
export function rankMockContent(
  userProfile: UserProfile,
  candidates: MockFeedItem[],
  weights: RankingWeights = DEFAULT_WEIGHTS
): RankedMockItem[] {
  // If no embedding, return chronological
  if (!userProfile.embedding) {
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

  // Score each item
  const scored = candidates.map(item => {
    const breakdown = {
      topicScore: computeTopicScore(item, userProfile),
      contentTypeScore: computeContentTypeScore(item, userProfile),
      timeScore: computeTimeScore(userProfile),
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

  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Apply exploration/exploitation mix
 */
export function applyExplorationMix(
  rankedItems: RankedMockItem[],
  exploitRatio = 0.8
): RankedMockItem[] {
  const exploitCount = Math.floor(rankedItems.length * exploitRatio);
  const exploreCount = rankedItems.length - exploitCount;

  const topItems = rankedItems.slice(0, exploitCount);
  const remainingItems = rankedItems.slice(exploitCount);
  const exploreItems = shuffleArray(remainingItems).slice(0, exploreCount);

  return shuffleArray([...topItems, ...exploreItems]);
}

// ============================================
// SCORING FUNCTIONS
// ============================================

function computeTopicScore(item: MockFeedItem, profile: UserProfile): number {
  if (!item.embedding || !profile.embedding) {
    return 0;
  }
  return cosineSimilarity(item.embedding, profile.embedding);
}

function computeContentTypeScore(item: MockFeedItem, profile: UserProfile): number {
  const affinity = profile.contentTypeAffinity[item.contentType];
  if (affinity === undefined) {
    return 0.5;
  }
  return (affinity + 1) / 2;
}

function computeTimeScore(profile: UserProfile): number {
  const currentHour = new Date().getHours();
  const currentTimeOfDay = getTimeOfDay(currentHour);

  const totalActivity = Object.values(profile.timeOfDayPatterns).reduce(
    (sum, val) => sum + val,
    0
  );

  if (totalActivity === 0) {
    return 0.5;
  }

  const activityAtThisTime = profile.timeOfDayPatterns[currentTimeOfDay];
  return activityAtThisTime / totalActivity;
}

function computeStyleScore(item: MockFeedItem, profile: UserProfile): number {
  const estimatedLength = (item.title?.length || 0) + (item.description?.length || 0);

  if (profile.engagementStyle.isDeepReader) {
    return Math.min(estimatedLength / 300, 1);
  } else if (profile.engagementStyle.quickBrowser) {
    return Math.max(1 - estimatedLength / 300, 0);
  }

  return 0.5;
}

function getRecencyScore(createdAt: Date): number {
  const now = new Date();
  const ageInHours = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
  return Math.exp(-ageInHours / 24);
}

function getPopularityScore(stats: MockFeedItem['stats']): number {
  const views = stats.views || 0;
  const engagement =
    (stats.likes || 0) + (stats.shares || 0) * 2 + (stats.bookmarks || 0) * 1.5;

  if (views === 0) {
    return 0;
  }

  const rate = engagement / views;
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
