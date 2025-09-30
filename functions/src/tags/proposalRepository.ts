import { firestore } from '../firebase/admin';
import { Timestamp } from 'firebase-admin/firestore';
import type { TagProposal, TagProposalSampleEvent, TagProposalStatus } from './types';

const COLLECTION = 'tagProposals';

export interface TagProposalRecord {
  slug: string;
  label: string;
  eventId: string;
  sourceId: string;
  sourceEventId?: string;
  eventTitle: string;
}

interface StoredTagProposal {
  slug: string;
  label: string;
  status: string;
  occurrenceCount: number;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  lastSeenAt: FirebaseFirestore.Timestamp;
  sourceCounts: Record<string, number>;
  sampleEvents: TagProposalSampleEventInternal[];
}

interface TagProposalSampleEventInternal {
  eventId: string;
  sourceId: string;
  sourceEventId?: string;
  title: string;
  seenAt: FirebaseFirestore.Timestamp;
}

export class TagProposalRepository {
  private readonly collection = firestore.collection(COLLECTION);

  async recordOccurrence(record: TagProposalRecord): Promise<void> {
    const slug = record.slug;
    if (!slug) {
      return;
    }

    const docRef = this.collection.doc(slug);
    await firestore.runTransaction(async tx => {
      const snapshot = await tx.get(docRef);
      const now = Timestamp.now();

      if (!snapshot.exists) {
        const data: StoredTagProposal = {
          slug,
          label: record.label,
          status: 'pending',
          occurrenceCount: 1,
          createdAt: now,
          updatedAt: now,
          lastSeenAt: now,
          sourceCounts: { [record.sourceId]: 1 },
          sampleEvents: [buildSampleEvent(record, now)],
        };

        tx.set(docRef, data);
        return;
      }

      const data = snapshot.data() as Partial<StoredTagProposal> | undefined;
      const occurrenceCount = (data?.occurrenceCount ?? 0) + 1;
      const sourceCounts = { ...(data?.sourceCounts ?? {}) };
      sourceCounts[record.sourceId] = (sourceCounts[record.sourceId] ?? 0) + 1;

      const sampleEvents = Array.isArray(data?.sampleEvents)
        ? trimSampleEvents(data.sampleEvents as TagProposalSampleEventInternal[], record, now)
        : [buildSampleEvent(record, now)];

      tx.update(docRef, {
        label: data?.label ?? record.label,
        occurrenceCount,
        sourceCounts,
        updatedAt: now,
        lastSeenAt: now,
        sampleEvents,
      });
    });
  }

  async getTopProposals(limit = 20): Promise<TagProposal[]> {
    const snapshot = await this.collection
      .where('status', '==', 'pending')
      .orderBy('occurrenceCount', 'desc')
      .orderBy('lastSeenAt', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs
      .map(doc => mapDocToProposal(doc))
      .filter((proposal): proposal is TagProposal => Boolean(proposal));
  }
}

function buildSampleEvent(record: TagProposalRecord, seenAt: FirebaseFirestore.Timestamp): TagProposalSampleEventInternal {
  return {
    eventId: record.eventId,
    sourceId: record.sourceId,
    sourceEventId: record.sourceEventId,
    title: record.eventTitle,
    seenAt,
  };
}

function trimSampleEvents(
  existing: TagProposalSampleEventInternal[],
  record: TagProposalRecord,
  now: FirebaseFirestore.Timestamp,
): TagProposalSampleEventInternal[] {
  const deduped = existing.filter(entry => entry.eventId !== record.eventId);
  deduped.unshift(buildSampleEvent(record, now));
  return deduped.slice(0, 5);
}

function mapDocToProposal(doc: FirebaseFirestore.DocumentSnapshot): TagProposal | null {
  if (!doc.exists) {
    return null;
  }

  const data = doc.data();
  if (!data) {
    return null;
  }

  const status = normalizeProposalStatus(data.status);
  const sourceCounts = normalizeSourceCounts(data.sourceCounts);

  return {
    slug: String(data.slug ?? doc.id).toLowerCase(),
    label: typeof data.label === 'string' ? data.label : doc.id,
    status,
    occurrenceCount: typeof data.occurrenceCount === 'number' ? data.occurrenceCount : 0,
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
    lastSeenAt: toIsoString(data.lastSeenAt),
    sourceCounts,
    sampleEvents: Array.isArray(data.sampleEvents)
      ? data.sampleEvents
          .map(entry => mapSampleEvent(entry))
          .filter((entry): entry is TagProposalSampleEvent => Boolean(entry))
      : undefined,
  };
}

function normalizeProposalStatus(value: unknown): TagProposalStatus {
  if (value === 'approved' || value === 'rejected') {
    return value;
  }
  return 'pending';
}

function normalizeSourceCounts(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, number] => typeof entry[0] === 'string' && typeof entry[1] === 'number');

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

function mapSampleEvent(input: unknown): TagProposalSampleEvent | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const data = input as Record<string, unknown>;
  const eventId = typeof data.eventId === 'string' ? data.eventId : null;
  const sourceId = typeof data.sourceId === 'string' ? data.sourceId : null;
  const title = typeof data.title === 'string' ? data.title : null;

  if (!eventId || !sourceId || !title) {
    return null;
  }

  return {
    eventId,
    sourceId,
    title,
    seenAt: toIsoString(data.seenAt),
  };
}

function toIsoString(value: unknown): string | null {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (isTimestamp(value)) {
    return value.toDate().toISOString();
  }
  return null;
}

function isTimestamp(value: unknown): value is FirebaseFirestore.Timestamp {
  return Boolean(value && typeof value === 'object' && 'toDate' in (value as Record<string, unknown>));
}
