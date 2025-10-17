export interface EventVenue {
  name?: string;
  address?: string;
  geo?: {
    lat: number;
    lng: number;
  };
  rawLocation?: string;
}

export interface EventSourceInfo {
  sourceId: string;
  sourceEventId: string;
  sourceUrl?: string;
}

export interface EventBreadcrumb {
  type: string;
  sourceId: string;
  sourceEventId: string;
  fetchedAt: string;
  snapshotPath?: string;
  metadata?: Record<string, unknown>;
}

export interface EventTagCandidate {
  tag: string;
  confidence: number;
  rationale?: string;
  source?: string;
}

export interface EventClassification {
  tags: string[];
  candidates: EventTagCandidate[];
  metadata?: Record<string, unknown>;
}

export interface CanonicalEvent {
  id: string;
  title: string;
  description?: string;
  contentType?: 'event' | 'flash-offer' | 'poll' | 'request' | 'photo' | 'announcement';
  seriesId?: string | null;
  startTime: string;
  endTime?: string;
  timeZone?: string;
  isAllDay?: boolean;
  recurrence?: string | null;
  venue?: EventVenue;
  organizer?: string | null;
  price?: string | null;
  tags: string[];
  breadcrumbs: EventBreadcrumb[];
  source: EventSourceInfo;
  status?: string;
  lastFetchedAt: string;
  lastUpdatedAt: string;
  rawSnapshotPath?: string;
  classification?: EventClassification;
  vector?: number[] | null;
}

export interface RawEventPayload<T = unknown> {
  sourceId: string;
  sourceEventId: string;
  fetchedAt: string;
  raw: T;
}
