import { Timestamp } from 'firebase-admin/firestore';
import { firestore } from '../firebase/admin';
import { EventHost } from '../models/eventHost';
import { createSlug } from '../utils/slug';

const COLLECTION = 'eventHosts';

export interface HostConfig {
  id: string;
  name: string;
  slug?: string;
  type?: string | null;
  calendarUrl?: string | null;
  websiteUrl?: string | null;
  timeZone?: string | null;
  metadata?: Record<string, unknown> | null;
  sourceIds?: string[];
}

type HostDocument = EventHost;

export class EventHostStore {
  async getById(id: string): Promise<EventHost | null> {
    const doc = await firestore.collection(COLLECTION).doc(id).get();
    if (!doc.exists) {
      return null;
    }
    return sanitizeHost(doc.data() as HostDocument, doc.id);
  }

  async ensureHost(config: HostConfig, sourceId?: string): Promise<EventHost> {
    const docRef = firestore.collection(COLLECTION).doc(config.id);
    const snapshot = await docRef.get();
    const now = Timestamp.now();

    const fallbackSlug = createSlug(config.name) || config.id;
    const desiredSlug = sanitizeSlug(config.slug ?? fallbackSlug);
    const desiredSourceIds = buildSourceIds(snapshot.exists ? (snapshot.data() as HostDocument)?.sourceIds : undefined, config.sourceIds, sourceId);

    if (!snapshot.exists) {
      const payload: HostDocument = {
        id: config.id,
        name: config.name,
        slug: desiredSlug,
        type: config.type ?? null,
        calendarUrl: config.calendarUrl ?? null,
        websiteUrl: config.websiteUrl ?? null,
        timeZone: config.timeZone ?? null,
        sourceIds: desiredSourceIds,
        metadata: config.metadata ?? null,
        createdAt: now,
        updatedAt: now,
      };
      await docRef.set(payload);
      return sanitizeHost(payload, config.id);
    }

    const existing = snapshot.data() as HostDocument;
    const updates: Partial<HostDocument> = {};
    let needsUpdate = false;

    if (existing.name !== config.name) {
      updates.name = config.name;
      needsUpdate = true;
    }

    if (existing.slug !== desiredSlug) {
      updates.slug = desiredSlug;
      needsUpdate = true;
    }

    if ((config.type ?? null) !== (existing.type ?? null)) {
      updates.type = config.type ?? null;
      needsUpdate = true;
    }

    if ((config.calendarUrl ?? null) !== (existing.calendarUrl ?? null)) {
      updates.calendarUrl = config.calendarUrl ?? null;
      needsUpdate = true;
    }

    if ((config.websiteUrl ?? null) !== (existing.websiteUrl ?? null)) {
      updates.websiteUrl = config.websiteUrl ?? null;
      needsUpdate = true;
    }

    if ((config.timeZone ?? null) !== (existing.timeZone ?? null)) {
      updates.timeZone = config.timeZone ?? null;
      needsUpdate = true;
    }

    if (config.metadata && JSON.stringify(config.metadata) !== JSON.stringify(existing.metadata ?? null)) {
      updates.metadata = config.metadata;
      needsUpdate = true;
    }

    if (!arraysEqual(existing.sourceIds, desiredSourceIds)) {
      updates.sourceIds = desiredSourceIds;
      needsUpdate = true;
    }

    if (needsUpdate) {
      updates.updatedAt = now;
      await docRef.update(updates);
    }

    const merged: HostDocument = {
      ...existing,
      ...updates,
      updatedAt: updates.updatedAt ?? existing.updatedAt,
    };

    return sanitizeHost(merged, config.id);
  }
}

function sanitizeHost(raw: HostDocument, id: string): EventHost {
  return {
    id,
    name: raw.name,
    slug: raw.slug,
    type: raw.type ?? null,
    calendarUrl: raw.calendarUrl ?? null,
    websiteUrl: raw.websiteUrl ?? null,
    timeZone: raw.timeZone ?? null,
    sourceIds: Array.isArray(raw.sourceIds) ? raw.sourceIds.filter((id): id is string => typeof id === 'string') : [],
    metadata: raw.metadata ?? null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function sanitizeSlug(value: string): string {
  const slug = value.trim();
  return slug.length > 0 ? slug : 'host';
}

function buildSourceIds(
  existing: string[] | undefined,
  supplied: string[] | undefined,
  sourceId?: string,
): string[] {
  const ids = new Set<string>();
  for (const id of existing ?? []) {
    if (typeof id === 'string' && id.trim().length > 0) {
      ids.add(id);
    }
  }
  for (const id of supplied ?? []) {
    if (typeof id === 'string' && id.trim().length > 0) {
      ids.add(id);
    }
  }
  if (sourceId) {
    ids.add(sourceId);
  }
  return Array.from(ids);
}

function arraysEqual(a: string[] | undefined, b: string[]): boolean {
  if (!a || a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}
