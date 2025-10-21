import { createHash } from 'crypto';
import { admin, firestore } from '../firebase/admin';
import { Timestamp } from 'firebase-admin/firestore';
import { CanonicalEvent, EventBreadcrumb } from '../models/event';
import { EventSeries, SeriesHost, SeriesOccurrence } from '../models/eventSeries';
import { RawEventPayload } from '../models/event';
import { buildStableId, createSlug } from '../utils/slug';

const SERIES_COLLECTION = 'eventSeries';

interface AttachEventOptions {
  hostId: string;
  hostName: string | null;
  organizer?: string | null;
  sourceId: string;
  rawPayload?: RawEventPayload<unknown>;
}

type StoredSeries = EventSeries & {
  occurrences?: SeriesOccurrence[];
};

export class EventSeriesStore {
  private readonly db: admin.firestore.Firestore;

  constructor(db?: admin.firestore.Firestore) {
    this.db = db ?? firestore;
  }

  buildSeriesId(hostId: string, title: string): string {
    const sanitizedTitle = createSlug(title || 'event') || 'event';
    const baseId = `${hostId}__${sanitizedTitle}`;
    if (baseId.length <= 200) {
      return baseId;
    }

    const hash = createHash('sha1').update(sanitizedTitle).digest('hex').slice(0, 12);
    const maxHostLength = Math.max(1, 200 - hash.length - 2);
    const trimmedHost = hostId.slice(0, maxHostLength);
    return `${trimmedHost}__${hash}`;
  }

  async attachEvent(
    event: CanonicalEvent,
    options: AttachEventOptions,
  ): Promise<{ seriesId: string; host: SeriesHost; created: boolean }> {
    const host = this.buildHost(options);
    const seriesId = this.buildSeriesId(host.id, event.title);
    const docRef = this.db.collection(SERIES_COLLECTION).doc(seriesId);
    let created = false;

    await this.db.runTransaction(async tx => {
      const snapshot = await tx.get(docRef);
      const now = Timestamp.now();

      const occurrence = this.buildOccurrence(event);

      if (!snapshot.exists) {
        const breadcrumbs = this.buildSeriesBreadcrumbs(event, options.rawPayload);
        const series: Omit<EventSeries, 'id'> = {
          title: event.title,
          description: event.description ?? null,
          summary: this.buildSummary(event),
          contentType: 'event-series',
          host,
          tags: Array.from(new Set(event.tags ?? [])),
          breadcrumbs,
          source: event.source,
          venue: event.venue ?? null,
          nextOccurrence: occurrence,
          upcomingOccurrences: occurrence ? [occurrence] : [],
          nextStartTime: occurrence ? occurrence.startTime : null,
          vector: event.vector ?? null,
          stats: {
            upcomingCount: occurrence ? 1 : 0,
          },
          createdAt: now,
          updatedAt: now,
        };

        tx.set(docRef, series);
        created = true;
        return;
      }

      const data = snapshot.data() as StoredSeries;
      const existingOccurrences = Array.isArray(data.upcomingOccurrences)
        ? this.sanitizeOccurrences(data.upcomingOccurrences)
        : [];

      const filteredOccurrences = occurrence
        ? this.mergeOccurrences(existingOccurrences, occurrence)
        : existingOccurrences;

      const tags = Array.from(new Set([...(data.tags ?? []), ...(event.tags ?? [])]));
      const breadcrumbs = this.mergeBreadcrumbs(data.breadcrumbs ?? [], event.breadcrumbs ?? []);
      const sourceIds = Array.from(new Set([...(data.host?.sourceIds ?? []), options.sourceId]));

      const nextOccurrence = filteredOccurrences.length > 0 ? filteredOccurrences[0] : null;

      tx.set(docRef, {
        title: event.title ?? data.title,
        description: data.description ?? event.description ?? null,
        summary: data.summary ?? this.buildSummary(event),
        contentType: 'event-series',
        host: {
          ...host,
          sourceIds,
        },
        tags,
        breadcrumbs,
        source: event.source,
        venue: event.venue ?? data.venue ?? null,
        nextOccurrence,
        upcomingOccurrences: filteredOccurrences,
        nextStartTime: nextOccurrence ? nextOccurrence.startTime : null,
        vector: event.vector ?? data.vector ?? null,
        stats: {
          upcomingCount: filteredOccurrences.length,
        },
        createdAt: data.createdAt ?? now,
        updatedAt: now,
      }, { merge: true });
    });

    return { seriesId, host, created };
  }

  private buildHost(options: AttachEventOptions): SeriesHost {
    const baseName = options.organizer?.trim() || options.hostName?.trim() || null;
    const slugParts = [
      options.hostId,
      baseName,
      options.sourceId,
    ];

    const fallback = createSlug(options.hostId || options.sourceId);
    const hostSlug = buildStableId(slugParts, fallback || 'host');
    const hostId = hostSlug.startsWith('host:') ? hostSlug : `host:${hostSlug}`;

    return {
      id: hostId,
      name: baseName,
      organizer: options.organizer ?? null,
      sourceIds: [options.sourceId],
    };
  }

  private buildOccurrence(event: CanonicalEvent): SeriesOccurrence | null {
    if (!event.startTime) {
      return null;
    }

    const start = new Date(event.startTime);
    if (Number.isNaN(start.getTime())) {
      return null;
    }

    const end = event.endTime ? new Date(event.endTime) : null;
    const endTimestamp = end && !Number.isNaN(end.getTime()) ? Timestamp.fromDate(end) : null;

    const occurrence: SeriesOccurrence = {
      eventId: event.id,
      title: event.title,
      startTime: Timestamp.fromDate(start),
      endTime: endTimestamp,
      location: event.venue?.name ?? event.venue?.rawLocation ?? null,
      tags: Array.isArray(event.tags) ? [...event.tags] : [],
    };

    return occurrence;
  }

  private sanitizeOccurrences(occurrences: SeriesOccurrence[]): SeriesOccurrence[] {
    const now = Date.now();
    const keepThreshold = now - 1000 * 60 * 60 * 24; // keep past 24 hours

    return occurrences
      .map(occurrence => {
        const startTs = this.extractTimestamp(occurrence.startTime);
        if (!startTs) {
          return null;
        }
        const startMs = startTs.toMillis();
        if (startMs < keepThreshold) {
          return null;
        }

        const endTs = this.extractTimestamp(occurrence.endTime);
        const tags = Array.isArray(occurrence.tags) ? [...occurrence.tags] : [];

        const title = typeof occurrence.title === 'string' ? occurrence.title : 'Untitled Event';

        return {
          eventId: occurrence.eventId,
          title,
          startTime: startTs,
          endTime: endTs,
          location: typeof occurrence.location === 'string' ? occurrence.location : null,
          tags,
        } as SeriesOccurrence;
      })
      .filter((occ): occ is SeriesOccurrence => Boolean(occ));
  }

  private mergeOccurrences(
    existing: SeriesOccurrence[],
    next: SeriesOccurrence,
  ): SeriesOccurrence[] {
    const filtered = existing.filter(item => item.eventId !== next.eventId);
    const updated = [...filtered, next];

    updated.sort((a, b) => a.startTime.toMillis() - b.startTime.toMillis());

    const limit = 20;
    return updated.slice(0, limit);
  }

  private extractTimestamp(value: FirebaseFirestore.Timestamp | null | undefined): FirebaseFirestore.Timestamp | null {
    if (!value) {
      return null;
    }

    if (value instanceof Timestamp) {
      return value;
    }

    if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { toDate?: () => Date }).toDate === 'function'
    ) {
      const date = (value as { toDate: () => Date }).toDate();
      return Timestamp.fromDate(date);
    }

    return null;
  }

  private mergeBreadcrumbs(existing: EventBreadcrumb[], next: EventBreadcrumb[]): EventBreadcrumb[] {
    const combined = [...existing];
    for (const breadcrumb of next) {
      if (!breadcrumb?.sourceEventId) {
        continue;
      }
      const exists = combined.some(item => item.sourceEventId === breadcrumb.sourceEventId);
      if (!exists) {
        combined.push(breadcrumb);
      }
    }
    return combined.slice(-20);
  }

  private buildSeriesBreadcrumbs(
    event: CanonicalEvent,
    payload?: RawEventPayload<unknown>,
  ): EventBreadcrumb[] {
    const existing = event.breadcrumbs ?? [];
    if (existing.length > 0) {
      return existing;
    }

    return [{
      type: 'series',
      sourceId: payload?.sourceId ?? event.source.sourceId,
      sourceEventId: payload?.sourceEventId ?? event.source.sourceEventId,
      fetchedAt: payload?.fetchedAt ?? event.lastFetchedAt,
    }];
  }

  private buildSummary(event: CanonicalEvent): string | null {
    const description = event.description?.trim();
    if (description && description.length > 0) {
      return description.split('\n').slice(0, 3).join('\n');
    }
    return null;
  }
}

export { SERIES_COLLECTION };
