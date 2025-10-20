import { EventBreadcrumb, EventSourceInfo, EventVenue } from './event';

export interface SeriesHost {
  id: string;
  name: string | null;
  organizer?: string | null;
  sourceIds: string[];
}

export interface SeriesOccurrence {
  eventId: string;
  title: string;
  startTime: FirebaseFirestore.Timestamp;
  endTime: FirebaseFirestore.Timestamp | null;
  location: string | null;
  tags: string[];
}

export interface EventSeries {
  id: string;
  title: string;
  description?: string | null;
  summary?: string | null;
  contentType: 'event-series';
  host: SeriesHost;
  tags: string[];
  breadcrumbs: EventBreadcrumb[];
  source: EventSourceInfo;
  venue?: EventVenue | null;
  categoryId?: string | null;
  categoryName?: string | null;
  categorySlug?: string | null;
  nextOccurrence: SeriesOccurrence | null;
  upcomingOccurrences: SeriesOccurrence[];
  nextStartTime: FirebaseFirestore.Timestamp | null;
  vector: number[] | null;
  stats?: {
    upcomingCount: number;
  };
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}
