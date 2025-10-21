import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import { firestore } from '../firebase/admin';
import { EventStore } from '../services/eventStore';
import { EventSeriesStore } from '../services/eventSeriesStore';
import { EventTagClassifier } from '../classification/eventClassifier';
import { OpenAIEmbeddingProvider } from '../classification/embeddings';
import { TagProposalService, shouldKeepGeneratedSlug } from '../tags/proposalService';
import { EventCategoryAssignmentService } from '../services/eventCategoryAssignment';
import type { CanonicalEvent, EventClassification, EventTagCandidate, RawEventPayload } from '../models/event';
import type { ClassificationCandidate, ClassificationResult } from '../classification/types';
import { buildStableId, createSlug } from '../utils/slug';

export interface SourceFetchOptions {
  startDate?: Date;
  endDateExclusive?: Date;
  targetDate?: Date;
}

export interface HostContext {
  hostIdSeed: string;
  hostName: string | null;
  organizer: string | null;
}

export interface NormalizedSourceEvent<TRaw> {
  event: CanonicalEvent;
  rawSnapshot: Record<string, unknown>;
  hostContext?: HostContext;
}

export interface SourceAdapter<TRaw> {
  readonly sourceId: string;
  readonly label?: string;
  fetchRawEvents(options?: SourceFetchOptions): Promise<Array<RawEventPayload<TRaw>>>;
  normalize(payload: RawEventPayload<TRaw>): NormalizedSourceEvent<TRaw>;
}

export interface IngestSourceOptions<TRaw> {
  adapter: SourceAdapter<TRaw>;
  fetchOptions?: SourceFetchOptions;
  forceRefresh?: boolean;
}

export interface IngestStats {
  sourceId: string;
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
}

type StoredEventData = {
  tags?: string[];
  classification?: EventClassification | null;
  vector?: number[] | null;
  lastUpdatedAt?: string | null;
};

type PreparedEvent<TRaw> = {
  payload: RawEventPayload<TRaw>;
  normalized: CanonicalEvent;
  rawSnapshot: Record<string, unknown>;
  hostContext: HostContext;
  text: string;
  vector?: number[] | null;
  existingSnapshot?: DocumentSnapshot | null;
  reuseClassification: boolean;
  existingClassification: EventClassification | null;
  existingTags: string[];
  lastUpdatedAt: string | null;
};

export async function ingestSource<TRaw>(options: IngestSourceOptions<TRaw>): Promise<IngestStats> {
  const adapter = options.adapter;
  const forceRefresh = Boolean(options.forceRefresh);
  const store = new EventStore();
  const seriesStore = new EventSeriesStore();
  const categoryAssignmentService = new EventCategoryAssignmentService();
  const embeddingProvider = new OpenAIEmbeddingProvider();
  const classifier = new EventTagClassifier({ embeddings: embeddingProvider });
  const proposalService = new TagProposalService();

  const rawEvents = await adapter.fetchRawEvents(options.fetchOptions);

  const prepared: Array<PreparedEvent<TRaw>> = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const payload of rawEvents) {
    try {
      const normalizedResult = adapter.normalize(payload);
      const normalized = normalizedResult.event;
      const text = [normalized.title, normalized.description].filter(Boolean).join('\n').trim();
      const existingSnapshot = await store.getEvent(normalized.id);
      const existingData = existingSnapshot?.data() as StoredEventData | undefined;
      const existingUpdated = getLastUpdatedTimestamp(existingSnapshot);
      const incomingUpdated = normalized.lastUpdatedAt;

      const reuseClassification = !forceRefresh && Boolean(
        existingSnapshot && incomingUpdated && existingUpdated && existingUpdated === incomingUpdated,
      );

      const vector = reuseClassification ? (existingData?.vector ?? null) : null;

      prepared.push({
        payload,
        normalized,
        rawSnapshot: normalizedResult.rawSnapshot,
        hostContext: normalizedResult.hostContext ?? deriveDefaultHostContext(normalized, adapter),
        text,
        vector,
        existingSnapshot,
        reuseClassification,
        existingClassification: reuseClassification ? existingData?.classification ?? null : null,
        existingTags: reuseClassification && Array.isArray(existingData?.tags) ? [...(existingData?.tags ?? [])] : [],
        lastUpdatedAt: existingUpdated,
      });
    } catch (error) {
      skipped += 1;
      console.error(`Failed to normalize event ${payload.sourceEventId} from ${payload.sourceId}`, error);
    }
  }

  for (const entry of prepared) {
    if (entry.reuseClassification) continue;

    try {
      const classification = await classifier.classify({
        title: entry.normalized.title,
        description: entry.normalized.description,
        vector: null,
      });

      entry.vector = classification.vector;
      entry.existingTags = classification.tags ?? [];
      const classificationResult: ClassificationResult = {
        tags: classification.tags,
        candidates: classification.candidates,
        metadata: classification.metadata,
        vector: classification.vector,
      };
      entry.existingClassification = {
        tags: classificationResult.tags,
        candidates: classificationResult.candidates?.map(c => ({
          tag: c.tag,
          confidence: c.confidence,
          rationale: c.rationale,
          source: normalizeCandidateSource(c.source),
        })) ?? [],
        metadata: classificationResult.metadata,
      };
    } catch (error) {
      console.error(`Failed to classify event ${entry.payload.sourceEventId}`, error);
    }
  }

  const textEntriesForEmbedding = prepared
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !entry.reuseClassification && entry.existingTags.length > 0)
    .map(({ entry, index }) => ({
      originalIndex: index,
      enrichedText: buildEnrichedText(
        entry.normalized.title,
        entry.normalized.description,
        entry.existingTags
      ),
    }));

  if (textEntriesForEmbedding.length > 0) {
    try {
      const vectors = await embeddingProvider.embedMany(
        textEntriesForEmbedding.map(entry => entry.enrichedText)
      );
      textEntriesForEmbedding.forEach((entry, idx) => {
        prepared[entry.originalIndex].vector = vectors[idx];
      });
    } catch (error) {
      console.error('Failed to batch embed enriched event texts', error);
    }
  }

  for (const entry of prepared) {
    const {
      payload,
      normalized,
      rawSnapshot,
      hostContext,
      vector,
      reuseClassification,
      existingClassification,
      existingTags,
      existingSnapshot,
    } = entry;

    try {
      if (reuseClassification && existingSnapshot && !forceRefresh) {
        await store.touchEvent(existingSnapshot.ref, normalized.lastUpdatedAt ?? normalized.lastFetchedAt);
        updated += 1;
        continue;
      }

      const classification = reuseClassification && existingClassification
        ? reuseClassificationResult(existingClassification, existingTags ?? [], vector ?? null)
        : existingClassification
          ? {
              tags: existingClassification.tags,
              candidates: existingClassification.candidates?.map(c => ({
                tag: c.tag,
                confidence: c.confidence,
                rationale: c.rationale,
                source: c.source,
              })),
              metadata: existingClassification.metadata,
              vector,
            } as ClassificationResult
          : await classifier.classify({
              title: normalized.title,
              description: normalized.description,
              vector: vector ?? null,
            });

      let proposalSlugs: string[] = [];
      try {
        proposalSlugs = await proposalService.processEvent({
          eventId: normalized.id,
          sourceId: normalized.source.sourceId,
          sourceEventId: normalized.source.sourceEventId,
          title: normalized.title,
          description: normalized.description,
          tags: Array.from(new Set([
            ...(normalized.tags ?? []),
            ...(classification.tags ?? []),
          ])),
        });
      } catch (proposalError) {
        console.warn('Failed to record tag proposals for event', normalized.id, proposalError);
      }

      applyClassification(normalized, classification, { additionalTags: proposalSlugs });

      let categoryAssignmentResult: { categoryId: string; categoryName: string } | null = null;
      try {
        const attachment = await seriesStore.attachEvent(normalized, {
          hostId: hostContext.hostIdSeed,
          hostName: hostContext.hostName,
          organizer: hostContext.organizer,
          sourceId: payload.sourceId,
          rawPayload: payload,
        });
        normalized.seriesId = attachment.seriesId;

        try {
          categoryAssignmentResult = await categoryAssignmentService.assignSeries({
            seriesId: attachment.seriesId,
            host: {
              id: attachment.host.id,
              name: attachment.host.name ?? hostContext.hostName,
            },
            force: forceRefresh || attachment.created,
          });
        } catch (categoryError) {
          console.error(`Failed to assign category for series ${attachment.seriesId}`, categoryError);
        }
      } catch (seriesError) {
        console.error(`Failed to attach event ${normalized.id} to series`, seriesError);
      }

      if (categoryAssignmentResult) {
        normalized.seriesCategoryId = categoryAssignmentResult.categoryId;
        normalized.seriesCategoryName = categoryAssignmentResult.categoryName;
      } else if (normalized.seriesId) {
        try {
          const snapshot = await firestore.collection('eventSeries').doc(normalized.seriesId).get();
          const seriesData = snapshot.data();
          if (seriesData) {
            const categoryId = typeof seriesData.categoryId === 'string' ? seriesData.categoryId : null;
            const categoryName = typeof seriesData.categoryName === 'string' ? seriesData.categoryName : null;
            if (categoryId || categoryName) {
              normalized.seriesCategoryId = categoryId ?? null;
              normalized.seriesCategoryName = categoryName ?? null;
            }
          }
        } catch (categoryFetchError) {
          console.warn(`Failed to fetch category metadata for series ${normalized.seriesId}`, categoryFetchError);
        }
      }

      const result = await store.saveEvent(normalized, rawSnapshot, existingSnapshot);
      if (result === 'created') {
        created += 1;
      } else {
        updated += 1;
      }
    } catch (error) {
      skipped += 1;
      console.error(`Failed to ingest event ${payload.sourceEventId} from ${payload.sourceId}`, error);
    }
  }

  return {
    sourceId: adapter.sourceId,
    fetched: rawEvents.length,
    created,
    updated,
    skipped,
  };
}

function getLastUpdatedTimestamp(snapshot: DocumentSnapshot | null | undefined): string | null {
  if (!snapshot?.exists) {
    return null;
  }

  const value = snapshot.get('lastUpdatedAt');
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return null;
}

function sanitizeName(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function deriveDefaultHostContext(event: CanonicalEvent, adapter: SourceAdapter<unknown>): HostContext {
  const organizer = sanitizeName(event.organizer);
  const label = sanitizeName(adapter.label);
  const fallbackSource = organizer ?? label ?? sanitizeName(event.source.sourceId) ?? sanitizeName(event.source.sourceUrl ?? null) ?? null;

  const hostIdSeed = buildStableId(
    [
      organizer,
      label,
      event.source.sourceId,
      event.source.sourceEventId,
    ],
    createSlug(fallbackSource ?? 'host'),
  ) || createSlug(event.source.sourceId) || 'host';

  const hostName = organizer ?? label ?? fallbackSource ?? null;

  return {
    hostIdSeed,
    hostName,
    organizer,
  };
}

function normalizeCandidateSource(source: string | undefined): ClassificationCandidate['source'] {
  if (source === 'llm' || source === 'embedding' || source === 'keyword') {
    return source;
  }
  return undefined;
}

function reuseClassificationResult(
  existing: EventClassification,
  tags: string[],
  vector: number[] | null,
): ClassificationResult {
  const baseTags = tags.length > 0 ? tags : existing.tags ?? [];
  const uniqueTags = Array.from(new Set(baseTags));
  const candidates: ClassificationCandidate[] = Array.isArray(existing.candidates)
    ? existing.candidates.map(candidate => ({
        tag: candidate.tag,
        confidence: candidate.confidence,
        rationale: candidate.rationale,
        source: normalizeCandidateSource(candidate.source),
      }))
    : [];
  const metadata = existing.metadata ? { ...existing.metadata, reused: true } : { llmUsed: false, embeddingsUsed: false, reused: true };
  metadata.llmUsed = false;
  metadata.embeddingsUsed = Boolean(vector);
  metadata.reused = true;

  return {
    tags: uniqueTags,
    candidates,
    metadata,
    vector,
  };
}

function applyClassification(
  event: CanonicalEvent,
  classification: Awaited<ReturnType<EventTagClassifier['classify']>>,
  options?: { additionalTags?: string[] },
) {
  const candidates: EventTagCandidate[] = (classification.candidates ?? []).map(candidate => ({
    tag: candidate.tag,
    confidence: candidate.confidence,
    rationale: candidate.rationale,
    source: candidate.source,
  }));

  const additionalTags = options?.additionalTags ?? [];
  const tagSet = new Set([...(classification.tags ?? []), ...additionalTags]);
  const sanitizedTags = Array.from(tagSet).filter(shouldKeepGeneratedSlug);
  event.tags = sanitizedTags;

  event.classification = {
    tags: sanitizedTags,
    candidates,
    metadata: classification.metadata,
  };

  event.vector = classification.vector ?? event.vector ?? null;
}

function buildEnrichedText(title: string, description: string | undefined, tags: string[]): string {
  const parts = [title];

  if (description?.trim()) {
    parts.push(description.trim());
  }

  if (tags.length > 0) {
    parts.push(`\nRelated topics: ${tags.join(', ')}`);
  }

  return parts.join('\n').trim();
}
