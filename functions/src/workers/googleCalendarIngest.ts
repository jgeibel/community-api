import { GoogleCalendarConnector, GoogleCalendarRawEvent } from '../connectors/googleCalendarConnector';
import { normalizeGoogleCalendarEvent } from '../normalizers/googleCalendarNormalizer';
import { firestore } from '../firebase/admin';
import { EventStore } from '../services/eventStore';
import { CanonicalEvent, EventClassification, EventTagCandidate, RawEventPayload } from '../models/event';
import { EventTagClassifier } from '../classification/eventClassifier';
import { OpenAIEmbeddingProvider } from '../classification/embeddings';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { TagProposalService, shouldKeepGeneratedSlug } from '../tags/proposalService';
import { Timestamp } from 'firebase-admin/firestore';
import type { ClassificationCandidate, ClassificationResult } from '../classification/types';
import { EventSeriesStore } from '../services/eventSeriesStore';
import { buildStableId, createSlug } from '../utils/slug';
import { EventCategoryAssignmentService } from '../services/eventCategoryAssignment';

export interface GoogleCalendarIngestConfig {
  calendarId: string;
  label?: string;
  targetDate?: Date;
  startDate?: Date;
  endDate?: Date;
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
  rawSnapshot?: { updated?: string } | null;
  lastUpdatedAt?: string | null;
};

type PreparedEvent = {
  payload: RawEventPayload<GoogleCalendarRawEvent>;
  normalized: CanonicalEvent;
  text: string;
  vector?: number[] | null;
  existingSnapshot?: DocumentSnapshot | null;
  reuseClassification: boolean;
  existingClassification: EventClassification | null;
  existingTags: string[];
  lastUpdatedAt: string | null;
};

export async function ingestGoogleCalendar(config: GoogleCalendarIngestConfig): Promise<IngestStats> {
  const connector = new GoogleCalendarConnector({ calendarId: config.calendarId, label: config.label });
  const store = new EventStore();
  const seriesStore = new EventSeriesStore();
  const categoryAssignmentService = new EventCategoryAssignmentService();
  const embeddingProvider = new OpenAIEmbeddingProvider();
  const classifier = new EventTagClassifier({ embeddings: embeddingProvider });
  const forceRefresh = Boolean(config.forceRefresh);
  const proposalService = new TagProposalService();

  if ((config.startDate && !config.endDate) || (!config.startDate && config.endDate)) {
    throw new Error('startDate and endDate must be provided together');
  }

  const rawEvents = config.startDate && config.endDate
    ? await connector.fetchRawEventsBetween(config.startDate, config.endDate)
    : config.targetDate
      ? await connector.fetchRawEventsForDate(config.targetDate)
      : await connector.fetchRawEvents();

  const prepared: Array<PreparedEvent> = [];

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const payload of rawEvents) {
    try {
      const normalized = normalizeEvent(payload);
      const text = [normalized.title, normalized.description].filter(Boolean).join('\n').trim();
      const existingSnapshot = await store.getEvent(normalized.id);
      const existingData = existingSnapshot?.data() as StoredEventData | undefined;
      const existingUpdated = existingData?.rawSnapshot?.updated;
      const incomingUpdated = payload.raw.raw.updated ?? null;

      const reuseClassification = !forceRefresh && Boolean(
        existingSnapshot && incomingUpdated && existingUpdated && existingUpdated === incomingUpdated,
      );

      const vector = reuseClassification ? (existingData?.vector ?? null) : null;

      const lastUpdatedAtValue = existingSnapshot?.get('lastUpdatedAt');
      let lastUpdatedAt: string | null = null;
      if (lastUpdatedAtValue instanceof Timestamp) {
        lastUpdatedAt = lastUpdatedAtValue.toDate().toISOString();
      } else if (typeof lastUpdatedAtValue === 'string') {
        lastUpdatedAt = lastUpdatedAtValue;
      }

      prepared.push({
        payload,
        normalized,
        text,
        vector,
        existingSnapshot,
        reuseClassification,
        existingClassification: reuseClassification ? existingData?.classification ?? null : null,
        existingTags: reuseClassification && Array.isArray(existingData?.tags) ? [...(existingData?.tags ?? [])] : [],
        lastUpdatedAt,
      });
    } catch (error) {
      skipped += 1;
      console.error(`Failed to normalize event ${payload.sourceEventId} from ${payload.sourceId}`, error);
    }
  }

  // Phase 1: Classify events to get tags (don't embed yet)
  for (const entry of prepared) {
    if (entry.reuseClassification) continue;

    try {
      const classification = await classifier.classify({
        title: entry.normalized.title,
        description: entry.normalized.description,
        vector: null, // We'll embed later with tags
      });

      // Store classification result temporarily (keep as ClassificationResult type)
      entry.vector = classification.vector;
      entry.existingTags = classification.tags ?? [];
      // Store as a proper ClassificationResult by converting candidates
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
          source: c.source as 'llm' | 'embedding' | 'keyword' | undefined,
        })) ?? [],
        metadata: classificationResult.metadata,
      };
    } catch (error) {
      console.error(`Failed to classify event ${entry.payload.sourceEventId}`, error);
    }
  }

  // Phase 2: Now embed with enriched text (title + description + tags)
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

  // Phase 3: Store events
  for (const entry of prepared) {
    const { payload, normalized, vector, reuseClassification, existingClassification, existingTags, existingSnapshot, lastUpdatedAt } = entry;
    try {
      if (reuseClassification && existingSnapshot && !forceRefresh) {
        await store.touchEvent(existingSnapshot.ref, payload.raw.raw.updated ?? lastUpdatedAt ?? payload.fetchedAt);
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
        const hostContext = deriveHostContext(normalized, payload);
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

      const result = await store.saveEvent(normalized, payload.raw, existingSnapshot);
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
    sourceId: connector.sourceId,
    fetched: rawEvents.length,
    created,
    updated,
    skipped,
  };
}

function normalizeEvent(payload: RawEventPayload<GoogleCalendarRawEvent>): CanonicalEvent {
  if (!payload.raw.start) {
    throw new Error('Missing start time');
  }

  return normalizeGoogleCalendarEvent(payload);
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

type HostContext = {
  hostIdSeed: string;
  hostName: string | null;
  organizer: string | null;
};

function deriveHostContext(
  event: CanonicalEvent,
  payload: RawEventPayload<GoogleCalendarRawEvent>,
): HostContext {
  const organizerFromEvent = sanitizeName(event.organizer);
  const organizerFromPayload = sanitizeName(
    payload.raw.raw.organizer?.displayName ?? payload.raw.raw.organizer?.email,
  );

  const organizer = organizerFromEvent ?? organizerFromPayload;

  const calendarId = sanitizeName(payload.raw.calendarId);
  const fallbackSource = organizer ?? calendarId ?? payload.sourceId;

  const hostIdSeed = buildStableId(
    [
      organizer,
      calendarId,
      payload.sourceId,
    ],
    createSlug(fallbackSource || 'host'),
  ) || createSlug(payload.sourceId) || 'host';

  const hostName = organizer ?? calendarId ?? fallbackSource ?? null;

  return {
    hostIdSeed,
    hostName,
    organizer,
  };
}

function sanitizeName(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
