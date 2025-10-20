import { Timestamp } from 'firebase-admin/firestore';
import { firestore } from '../firebase/admin';
import { EventCategoryClassifier, EventCategoryClassificationInput, buildCategoryId } from '../classification/eventCategoryClassifier';
import { EventCategoryStore } from './eventCategoryStore';
import { CategoryAssignment } from '../models/eventCategory';
import { createSlug } from '../utils/slug';

interface AssignSeriesOptions {
  seriesId: string;
  host: {
    id: string;
    name: string | null;
  };
  force?: boolean;
}

export class EventCategoryAssignmentService {
  private readonly classifier: EventCategoryClassifier;
  private readonly store: EventCategoryStore;

  constructor(options?: { classifier?: EventCategoryClassifier; store?: EventCategoryStore }) {
    this.classifier = options?.classifier ?? new EventCategoryClassifier();
    this.store = options?.store ?? new EventCategoryStore();
  }

  async assignSeries(options: AssignSeriesOptions): Promise<CategoryAssignment | null> {
    const seriesRef = firestore.collection('eventSeries').doc(options.seriesId);
    const snapshot = await seriesRef.get();
    if (!snapshot.exists) {
      throw new Error(`Series ${options.seriesId} not found`);
    }

    const data = snapshot.data() ?? {};
    const existingCategoryId = typeof data.categoryId === 'string' ? data.categoryId : null;
    const existingCategoryName = typeof data.categoryName === 'string' ? data.categoryName : null;

    if (existingCategoryId && existingCategoryName && !options.force) {
      return {
        categoryId: existingCategoryId,
        categoryName: existingCategoryName,
      };
    }

    const seriesTitle = typeof data.title === 'string' ? data.title : 'Untitled Series';
    const seriesDescription = typeof data.description === 'string' ? data.description : (typeof data.summary === 'string' ? data.summary : null);
    const seriesTags = Array.isArray(data.tags) ? data.tags.filter((tag: unknown): tag is string => typeof tag === 'string') : [];

    const existingCategories = await this.store.listByHost(options.host.id);
    const input: EventCategoryClassificationInput = {
      hostName: options.host.name,
      seriesTitle,
      seriesDescription,
      seriesTags,
      existingCategories: existingCategories.map(category => ({
        id: category.id,
        name: category.name,
        description: category.description,
        sampleSeriesTitles: category.sampleSeriesTitles ?? [],
      })),
    };

    const classification = await this.classifier.classify(input);
    const normalizedName = classification.categoryName.trim();

    const existingMatch = existingCategories.find(category =>
      category.name.localeCompare(normalizedName, undefined, { sensitivity: 'accent' }) === 0,
    );

    const categoryId = existingMatch?.id ?? buildCategoryId(options.host.id, normalizedName);
    const categoryName = existingMatch?.name ?? normalizedName;

    if (!existingMatch && classification.action === 'create-new') {
      await this.store.createCategory({
        id: categoryId,
        hostId: options.host.id,
        name: categoryName,
        tags: seriesTags,
        seriesId: options.seriesId,
        seriesTitle,
      });
    }

    if (existingMatch) {
      await this.store.addSeriesToCategory(existingMatch.id, options.seriesId, seriesTitle, seriesTags);
    } else {
      // ensure the new category has the series entry even if it already existed by id but not in store list
      await this.store.addSeriesToCategory(categoryId, options.seriesId, seriesTitle, seriesTags);
    }

    if (existingCategoryId && existingCategoryId !== categoryId) {
      await this.store.removeSeriesFromCategory(existingCategoryId, options.seriesId);
    }

    await seriesRef.set({
      categoryId,
      categoryName,
      categorySlug: createSlug(categoryName) || categoryId,
      updatedAt: Timestamp.now(),
    }, { merge: true });

    return { categoryId, categoryName };
  }
}
