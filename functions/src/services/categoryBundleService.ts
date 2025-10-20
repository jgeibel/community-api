import { Timestamp } from 'firebase-admin/firestore';
import { ContentItem } from './feedRankingService';
import { FeedSeriesData, FeedSeriesCategory, FeedSeriesHost, FeedSeriesOccurrence } from '../api/feedTypes';
import { EventCategoryStore } from './eventCategoryStore';
import { CategoryBundleStateService } from './categoryBundleStateService';
import { EventCategory } from '../models/eventCategory';
import { firestore } from '../firebase/admin';
import { mapSeriesForFeed } from '../api/feedHelpers';

export interface SeriesCandidate {
  contentItem: ContentItem;
  series: FeedSeriesData;
}

export interface CategoryBundleMetadata {
  type: 'category-bundle';
  bundleId: string;
  category: FeedSeriesCategory;
  host: FeedSeriesHost;
  totalSeriesCount: number;
  newSeriesCount: number;
  seriesIds: string[];
  newSeriesIds: string[];
  displaySeries: FeedSeriesData[];
  allSeries: FeedSeriesData[];
  version: number;
  lastSeenVersion: number | null;
  isNewCategory: boolean;
  bundleState: {
    categoryId: string;
    version: number;
  };
}

type CategoryGroup = {
  key: string;
  categoryId: string;
  hostId: string;
  host: FeedSeriesHost;
  items: SeriesCandidate[];
};

export class CategoryBundleService {
  private readonly categoryStore: EventCategoryStore;
  private readonly stateService: CategoryBundleStateService;

  constructor(options?: { categoryStore?: EventCategoryStore; stateService?: CategoryBundleStateService }) {
    this.categoryStore = options?.categoryStore ?? new EventCategoryStore();
    this.stateService = options?.stateService ?? new CategoryBundleStateService();
  }

  async buildBundles(
    userId: string | undefined,
    candidates: SeriesCandidate[],
    options?: { windowStart?: Date; windowEnd?: Date }
  ): Promise<ContentItem[]> {
    const unbundled: ContentItem[] = [];
    const groups = this.groupCandidates(candidates, unbundled);

    if (groups.length === 0) {
      return unbundled;
    }

    const categoryIds = Array.from(new Set(groups.map(group => group.categoryId)));
    const [categories, userState] = await Promise.all([
      this.categoryStore.getMany(categoryIds),
      userId ? this.stateService.getStates(userId, categoryIds) : Promise.resolve(new Map()),
    ]);

    const categoryMap = new Map<string, EventCategory>();
    categories.forEach(category => categoryMap.set(category.id, category));

    const results: ContentItem[] = [...unbundled];

    for (const group of groups) {
      const category = categoryMap.get(group.categoryId);
      if (!category) {
        // Fallback: no category metadata available, surface underlying series instead
        group.items.forEach(item => results.push(item.contentItem));
        continue;
      }

      const state = userState.get(group.categoryId);
      const lastSeenVersion = state && state.lastSeenVersion > 0 ? state.lastSeenVersion : null;
      const bundleItem = await this.buildBundleItem(group, category, lastSeenVersion, options);
      if (bundleItem) {
        results.push(bundleItem);
      }
    }

    return results;
  }

  private groupCandidates(candidates: SeriesCandidate[], unbundled: ContentItem[]): CategoryGroup[] {
    const groups = new Map<string, CategoryGroup>();

    candidates.forEach(candidate => {
      const series = candidate.series;
      const categoryId = series.category?.id ?? null;
      const hostId = series.host?.id ?? null;

      if (!categoryId || !hostId) {
        unbundled.push(candidate.contentItem);
        return;
      }

      const key = `${hostId}__${categoryId}`;
      const existing = groups.get(key);
      if (existing) {
        existing.items.push(candidate);
      } else {
        groups.set(key, {
          key,
          categoryId,
          hostId,
          host: series.host,
          items: [candidate],
        });
      }
    });

    return Array.from(groups.values());
  }

  private async buildBundleItem(
    group: CategoryGroup,
    category: EventCategory,
    lastSeenVersion: number | null,
    options?: { windowStart?: Date; windowEnd?: Date },
  ): Promise<ContentItem | null> {
    const fullSeries = await this.loadFullSeries(group, category, options);
    if (fullSeries.length === 0) {
      return null;
    }

    const seriesIds = fullSeries.map(series => series.id);
    const totalSeriesCount = seriesIds.length;
    const version = typeof category.version === 'number' ? category.version : 1;

    const newSeriesIdsSet = this.computeNewSeriesIds(category, seriesIds, version, lastSeenVersion);
    const isNewCategory = lastSeenVersion === null;

    if (!isNewCategory && newSeriesIdsSet.size === 0) {
      // No updates for this user, skip surfacing the bundle
      return null;
    }

    const displaySeriesIds = isNewCategory ? seriesIds : Array.from(newSeriesIdsSet);
    const displaySeries = fullSeries.filter(series => displaySeriesIds.includes(series.id));

    if (displaySeries.length === 0) {
      // Safety fallback – show entire collection if diff computation failed
      displaySeries.push(...fullSeries);
    }

    const contentItem = this.mergeContentItems(group.items);
    const metadata: CategoryBundleMetadata = {
      type: 'category-bundle',
      bundleId: `bundle:${group.categoryId}`,
      category: {
        id: category.id,
        name: category.name,
        slug: category.slug,
      },
      host: group.host,
      totalSeriesCount,
      newSeriesCount: displaySeries.length,
      seriesIds,
      newSeriesIds: Array.from(newSeriesIdsSet),
      displaySeries,
      allSeries: fullSeries,
      version,
      lastSeenVersion,
      isNewCategory,
      bundleState: {
        categoryId: category.id,
        version,
      },
    };

    return {
      ...contentItem,
      id: `bundle:${category.id}`,
      title: this.buildBundleTitle(category.name, group.host),
      contentType: 'event-category-bundle',
      metadata: {
        ...contentItem.metadata,
        bundle: metadata,
      },
    };
  }

  private async loadFullSeries(
    group: CategoryGroup,
    category: EventCategory,
    options?: { windowStart?: Date; windowEnd?: Date },
  ): Promise<FeedSeriesData[]> {
    const windowStart = options?.windowStart ?? null;
    const windowEnd = options?.windowEnd ?? null;

    const existing = new Map<string, FeedSeriesData>();
    group.items.forEach(item => {
      existing.set(item.series.id, item.series);
    });

    const targetIds = Array.isArray(category.seriesIds) && category.seriesIds.length > 0
      ? category.seriesIds
      : Array.from(existing.keys());
    const missingIds = targetIds.filter(id => !existing.has(id));

    if (missingIds.length > 0) {
      const docRefs = missingIds.map(id => firestore.collection('eventSeries').doc(id));
      const snapshots = await firestore.getAll(...docRefs);
      snapshots.forEach(snapshot => {
        if (!snapshot.exists) {
          return;
        }
        const series = mapSeriesForFeed(snapshot);
        existing.set(series.id, series);
      });
    }

    const allSeries = Array.from(existing.values()).filter(series =>
      this.isSeriesWithinWindow(series, windowStart, windowEnd)
    );

    allSeries.sort((a, b) => {
      const aTime = this.getFirstOccurrenceTime(a);
      const bTime = this.getFirstOccurrenceTime(b);
      if (aTime === null && bTime === null) {
        return 0;
      }
      if (aTime === null) {
        return 1;
      }
      if (bTime === null) {
        return -1;
      }
      return aTime.getTime() - bTime.getTime();
    });

    return allSeries;
  }

  private getFirstOccurrenceTime(series: FeedSeriesData): Date | null {
    const occurrences = [
      series.nextOccurrence,
      ...(series.upcomingOccurrences ?? []),
    ].filter((occ): occ is FeedSeriesOccurrence => Boolean(occ));
    if (occurrences.length === 0) {
      return null;
    }
    const dates = occurrences
      .map(occ => new Date(occ.startTime))
      .filter(date => !Number.isNaN(date.getTime()));
    if (dates.length === 0) {
      return null;
    }
    dates.sort((a, b) => a.getTime() - b.getTime());
    return dates[0];
  }

  private isSeriesWithinWindow(
    series: FeedSeriesData,
    windowStart: Date | null,
    windowEnd: Date | null
  ): boolean {
    if (!windowStart && !windowEnd) {
      return true;
    }

    const occurrences = [series.nextOccurrence, ...(series.upcomingOccurrences ?? [])]
      .filter((occ): occ is FeedSeriesOccurrence => Boolean(occ));

    if (occurrences.length === 0) {
      return false;
    }

    return occurrences.some(occ => {
      const start = new Date(occ.startTime);
      if (Number.isNaN(start.getTime())) {
        return false;
      }
      if (windowStart && start < windowStart) {
        return false;
      }
      if (windowEnd && start >= windowEnd) {
        return false;
      }
      return true;
    });
  }

  private computeNewSeriesIds(
    category: EventCategory,
    currentSeriesIds: string[],
    version: number,
    lastSeenVersion: number | null,
  ): Set<string> {
    if (lastSeenVersion === null) {
      return new Set(currentSeriesIds);
    }

    const newIds = new Set<string>();
    const cutoffVersion = lastSeenVersion ?? 0;
    const changeLog = Array.isArray(category.changeLog) ? category.changeLog : [];

    changeLog
      .filter(entry => entry.version > cutoffVersion)
      .forEach(entry => entry.addedSeriesIds.forEach(id => newIds.add(id)));

    if (newIds.size === 0 && version > cutoffVersion) {
      currentSeriesIds.forEach(id => newIds.add(id));
    }

    return newIds;
  }

  private mergeContentItems(items: SeriesCandidate[]): ContentItem {
    const createdAt = items.reduce<Date | null>((latest, item) => {
      if (!latest || item.contentItem.createdAt > latest) {
        return item.contentItem.createdAt;
      }
      return latest;
    }, null) ?? new Date();

    const stats = items.reduce(
      (acc, item) => {
        acc.views += item.contentItem.stats.views ?? 0;
        acc.likes += item.contentItem.stats.likes ?? 0;
        acc.shares += item.contentItem.stats.shares ?? 0;
        acc.bookmarks += item.contentItem.stats.bookmarks ?? 0;
        return acc;
      },
      { views: 0, likes: 0, shares: 0, bookmarks: 0 },
    );

    const tags = Array.from(
      new Set(
        items.flatMap(item => item.contentItem.tags)
      )
    );

    const embeddings = items
      .map(item => item.contentItem.embedding)
      .filter((embedding): embedding is number[] => Array.isArray(embedding));

    return {
      id: items[0]?.contentItem.id ?? `bundle:${Timestamp.now().toMillis()}`,
      title: items[0]?.contentItem.title ?? 'Community programming',
      contentType: items[0]?.contentItem.contentType ?? 'event-series',
      tags,
      embedding: embeddings.length > 0 ? averageVectors(embeddings) : null,
      createdAt,
      stats,
      metadata: items[0]?.contentItem.metadata ?? {},
    };
  }

  private buildBundleTitle(categoryName: string, host: FeedSeriesHost): string {
    const normalizedCategory = categoryName || 'Community programming';
    const hostName = host?.name ?? host?.organizer ?? null;
    if (!hostName) {
      return normalizedCategory;
    }
    return `${normalizedCategory} · ${hostName}`;
  }
}

function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) {
    return [];
  }
  const length = vectors[0].length;
  const sums = new Array<number>(length).fill(0);
  vectors.forEach(vector => {
    vector.forEach((value, index) => {
      sums[index] += value;
    });
  });
  return sums.map(sum => sum / vectors.length);
}
