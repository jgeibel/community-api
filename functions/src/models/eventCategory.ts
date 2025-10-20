import { Timestamp } from 'firebase-admin/firestore';

export interface EventCategory {
  id: string;
  hostId: string;
  name: string;
  slug: string;
  description?: string | null;
  tags: string[];
  sampleSeriesTitles: string[];
  seriesIds: string[];
  version: number;
  changeLog: EventCategoryChangeLogEntry[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface EventCategorySummary {
  id: string;
  hostId: string;
  name: string;
  slug: string;
  description?: string | null;
  tags: string[];
  sampleSeriesTitles: string[];
  seriesIds: string[];
  version: number;
  changeLog: EventCategoryChangeLogEntry[];
  updatedAt: Timestamp;
}

export interface CategoryAssignment {
  categoryId: string;
  categoryName: string;
}

export interface EventCategoryChangeLogEntry {
  version: number;
  addedSeriesIds: string[];
  addedSeriesTitles: string[];
  createdAt: Timestamp;
}
