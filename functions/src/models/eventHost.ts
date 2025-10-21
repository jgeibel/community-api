import { Timestamp } from 'firebase-admin/firestore';

export interface EventHost {
  id: string;
  name: string;
  slug: string;
  type?: string | null;
  calendarUrl?: string | null;
  websiteUrl?: string | null;
  timeZone?: string | null;
  sourceIds: string[];
  metadata?: Record<string, unknown> | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
