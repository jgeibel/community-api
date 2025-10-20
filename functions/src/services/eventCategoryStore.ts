import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { firestore } from '../firebase/admin';
import { EventCategory, EventCategorySummary, EventCategoryChangeLogEntry } from '../models/eventCategory';
import { createSlug } from '../utils/slug';

const COLLECTION = 'eventCategories';
const SAMPLE_SERIES_LIMIT = 8;
const CHANGE_LOG_LIMIT = 25;

interface CategoryCreateInput {
  id: string;
  hostId: string;
  name: string;
  tags: string[];
  seriesId: string;
  seriesTitle: string;
}

export class EventCategoryStore {
  async listByHost(hostId: string): Promise<EventCategorySummary[]> {
    const snapshot = await firestore
      .collection(COLLECTION)
      .where('hostId', '==', hostId)
      .get();

    const results = snapshot.docs.map(doc => {
      const data = doc.data() as EventCategory;
      return {
        id: doc.id,
        hostId: data.hostId,
        name: data.name,
        slug: data.slug,
        description: data.description ?? null,
        tags: Array.isArray(data.tags) ? data.tags : [],
        sampleSeriesTitles: Array.isArray(data.sampleSeriesTitles) ? data.sampleSeriesTitles : [],
        seriesIds: Array.isArray(data.seriesIds) ? data.seriesIds : [],
        version: typeof data.version === 'number' ? data.version : 1,
        changeLog: sanitizeChangeLog(data.changeLog),
        updatedAt: data.updatedAt,
      };
    });

    return results.sort((a, b) => {
      const aTime = a.updatedAt?.toMillis?.() ?? 0;
      const bTime = b.updatedAt?.toMillis?.() ?? 0;
      return bTime - aTime;
    });
  }

  async createCategory(input: CategoryCreateInput): Promise<void> {
    const now = Timestamp.now();
    const docRef = firestore.collection(COLLECTION).doc(input.id);
    const changeLogEntry: EventCategoryChangeLogEntry = {
      version: 1,
      addedSeriesIds: [input.seriesId],
      addedSeriesTitles: [input.seriesTitle].filter(Boolean),
      createdAt: now,
    };

    await docRef.set({
      id: input.id,
      hostId: input.hostId,
      name: input.name,
      slug: createSlug(input.name) || input.id,
      description: null,
      tags: sanitizeTags(input.tags),
      sampleSeriesTitles: [input.seriesTitle].filter(Boolean),
      seriesIds: [input.seriesId],
      version: 1,
      changeLog: [changeLogEntry],
      createdAt: now,
      updatedAt: now,
    }, { merge: true });
  }

  async addSeriesToCategory(categoryId: string, seriesId: string, seriesTitle: string, tags: string[]): Promise<void> {
    const docRef = firestore.collection(COLLECTION).doc(categoryId);

    await firestore.runTransaction(async tx => {
      const snapshot = await tx.get(docRef);
      if (!snapshot.exists) {
        throw new Error(`Event category ${categoryId} not found`);
      }
      const data = snapshot.data() as EventCategory;
      const sampleTitles = Array.isArray(data.sampleSeriesTitles) ? [...data.sampleSeriesTitles] : [];
      if (seriesTitle && !sampleTitles.includes(seriesTitle)) {
        sampleTitles.push(seriesTitle);
      }
      const trimmedSamples = sampleTitles.slice(-SAMPLE_SERIES_LIMIT);

      const nextTags = mergeTags(data.tags, tags);
      const now = Timestamp.now();
      const updates: Record<string, unknown> = {
        sampleSeriesTitles: trimmedSamples,
        tags: nextTags,
        updatedAt: now,
        seriesIds: FieldValue.arrayUnion(seriesId),
      };

      const alreadyInCategory = Array.isArray(data.seriesIds) && data.seriesIds.includes(seriesId);
      if (!alreadyInCategory) {
        const currentVersion = typeof data.version === 'number' ? data.version : 1;
        const nextVersion = currentVersion + 1;
        const existingChangeLog = sanitizeChangeLog(data.changeLog);
        const changeLogEntry: EventCategoryChangeLogEntry = {
          version: nextVersion,
          addedSeriesIds: [seriesId],
          addedSeriesTitles: [seriesTitle].filter(Boolean),
          createdAt: now,
        };
        const trimmedChangeLog = [...existingChangeLog, changeLogEntry].slice(-CHANGE_LOG_LIMIT);

        Object.assign(updates, {
          version: nextVersion,
          changeLog: trimmedChangeLog,
        });
      }

      tx.update(docRef, updates);
    });
  }

  async removeSeriesFromCategory(categoryId: string, seriesId: string): Promise<void> {
    const docRef = firestore.collection(COLLECTION).doc(categoryId);
    await docRef.update({
      seriesIds: FieldValue.arrayRemove(seriesId),
      updatedAt: Timestamp.now(),
    }).catch(error => {
      console.warn(`Failed to remove series ${seriesId} from category ${categoryId}`, error);
    });
  }

  async getMany(categoryIds: string[]): Promise<EventCategory[]> {
    if (categoryIds.length === 0) {
      return [];
    }

    const uniqueIds = Array.from(new Set(categoryIds));
    const docRefs = uniqueIds.map(id => firestore.collection(COLLECTION).doc(id));
    const snapshots = await firestore.getAll(...docRefs);

    return snapshots
      .filter(snapshot => snapshot.exists)
      .map(snapshot => {
        const data = snapshot.data() as EventCategory;
        return {
          ...data,
          id: snapshot.id,
          tags: Array.isArray(data.tags) ? data.tags : [],
          sampleSeriesTitles: Array.isArray(data.sampleSeriesTitles) ? data.sampleSeriesTitles : [],
          seriesIds: Array.isArray(data.seriesIds) ? data.seriesIds : [],
          version: typeof data.version === 'number' ? data.version : 1,
          changeLog: sanitizeChangeLog(data.changeLog),
        };
      });
  }
}

function sanitizeTags(tags: string[]): string[] {
  const set = new Set<string>();
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const normalized = tag.trim().toLowerCase();
    if (normalized.length === 0) continue;
    set.add(normalized);
  }
  return Array.from(set).slice(0, 25);
}

function mergeTags(existing: unknown, next: string[]): string[] {
  const base = Array.isArray(existing) ? existing : [];
  const merged = new Set<string>(sanitizeTags(base));
  for (const tag of sanitizeTags(next)) {
    merged.add(tag);
  }
  return Array.from(merged).slice(0, 50);
}

function sanitizeChangeLog(value: unknown): EventCategoryChangeLogEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(entry => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const version = typeof record.version === 'number' ? record.version : null;
      const createdAt = record.createdAt instanceof Timestamp ? record.createdAt : null;
      if (!version || !createdAt) {
        return null;
      }

      const addedSeriesIds = Array.isArray(record.addedSeriesIds)
        ? record.addedSeriesIds.filter((id): id is string => typeof id === 'string')
        : [];
      const addedSeriesTitles = Array.isArray(record.addedSeriesTitles)
        ? record.addedSeriesTitles.filter((title): title is string => typeof title === 'string')
        : [];

      return {
        version,
        addedSeriesIds,
        addedSeriesTitles,
        createdAt,
      };
    })
    .filter((entry): entry is EventCategoryChangeLogEntry => Boolean(entry));
}
