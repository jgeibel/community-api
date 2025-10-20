export type FeedSeriesOccurrence = {
  eventId: string;
  title: string | null;
  startTime: string;
  endTime: string | null;
  location: string | null;
  tags: string[];
};

export type FeedSeriesHost = {
  id?: string | null;
  name?: string | null;
  organizer?: string | null;
  sourceIds?: string[];
} | null;

export type FeedSeriesCategory = {
  id: string | null;
  name: string | null;
  slug: string | null;
};

export type FeedSeriesData = {
  id: string;
  title: string | null;
  description: string | null;
  summary: string | null;
  host: FeedSeriesHost;
  tags: string[];
  source: unknown;
  category: FeedSeriesCategory;
  nextOccurrence: FeedSeriesOccurrence | null;
  upcomingOccurrences: FeedSeriesOccurrence[];
};
