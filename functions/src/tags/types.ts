export type TagProposalStatus = 'pending' | 'approved' | 'rejected';

export interface TagProposalSampleEvent {
  eventId: string;
  sourceId: string;
  title: string;
  seenAt?: string | null;
}

export interface TagProposal {
  slug: string;
  label: string;
  status: TagProposalStatus;
  occurrenceCount: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  lastSeenAt?: string | null;
  sourceCounts?: Record<string, number>;
  sampleEvents?: TagProposalSampleEvent[];
}
