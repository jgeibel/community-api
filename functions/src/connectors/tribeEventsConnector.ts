import type { RawEventPayload } from '../models/event';
import type { SourceConnector } from './types';

interface TribeEventsConnectorConfig {
  baseUrl: string;
  label?: string;
  perPage?: number;
}

interface TribeEventsApiResponse {
  events: TribeEventsApiEvent[];
  total: number;
  total_pages: number;
  page: number;
  per_page: number;
}

export interface TribeEventsApiEvent {
  id: number;
  status: string;
  title: string;
  description?: string;
  url: string;
  rest_url: string;
  start_date: string;
  end_date: string;
  utc_start_date: string;
  utc_end_date: string;
  timezone?: string;
  timezone_abbr?: string;
  cost?: string;
  website?: string;
  show_map?: boolean;
  show_map_link?: boolean;
  hide_from_listings?: boolean;
  sticky?: boolean;
  featured?: boolean;
  categories?: Array<{ id: number; name: string; slug: string }>;
  tags?: Array<{ id: number; name: string; slug: string }>;
  venue?: TribeEventsVenueApi | TribeEventsVenueApi[];
  venues?: TribeEventsVenueApi[];
  organizer?: TribeEventsOrganizerApi | TribeEventsOrganizerApi[];
  organizers?: TribeEventsOrganizerApi[];
  all_day: boolean;
  modified?: string;
  modified_utc?: string;
  date?: string;
  date_utc?: string;
}

interface TribeEventsVenueApi {
  id: number;
  venue?: string;
  address?: string;
  city?: string;
  state?: string;
  province?: string;
  stateprovince?: string;
  zip?: string;
  country?: string;
  phone?: string;
  website?: string;
}

interface TribeEventsOrganizerApi {
  id: number;
  organizer?: string;
  phone?: string;
  website?: string;
  email?: string;
}

export interface TribeEventsRawEvent {
  id: number;
  title: string;
  description?: string;
  status: string;
  startDate: string;
  endDate: string;
  utcStartDate: string;
  utcEndDate: string;
  timezone?: string;
  allDay: boolean;
  cost?: string;
  website?: string;
  url: string;
  restUrl: string;
  categories: string[];
  tags: string[];
  venue?: TribeEventsVenueApi | null;
  organizers: TribeEventsOrganizerApi[];
  modifiedUtc?: string;
  fetchedUrl: string;
  raw: TribeEventsApiEvent;
}

export class TribeEventsConnector implements SourceConnector<TribeEventsRawEvent> {
  private readonly baseUrl: string;
  private readonly hostname: string;
  private readonly perPage: number;
  readonly label?: string;

  constructor(config: TribeEventsConnectorConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.hostname = new URL(this.baseUrl).hostname;
    this.perPage = config.perPage ?? 50;
    this.label = config.label;
  }

  get sourceId(): string {
    return `tribe-events:${this.hostname}`;
  }

  async fetchRawEvents(): Promise<Array<RawEventPayload<TribeEventsRawEvent>>> {
    return this.fetchRawEventsWithParams({});
  }

  async fetchRawEventsWithParams(params: Record<string, string>): Promise<Array<RawEventPayload<TribeEventsRawEvent>>> {
    const fetchedAt = new Date().toISOString();
    const results: Array<RawEventPayload<TribeEventsRawEvent>> = [];
    let page = 1;
    let totalPages = 1;

    do {
      const search = new URLSearchParams({
        per_page: String(this.perPage),
        page: String(page),
        ...params,
      });

      const url = `${this.baseUrl}/wp-json/tribe/events/v1/events?${search.toString()}`;
      const response = await this.fetchWithRetry(url);
      totalPages = Math.max(1, response.total_pages ?? 1);

      for (const item of response.events ?? []) {
        const mapped = this.mapEvent(item, url);
        results.push({
          sourceId: this.sourceId,
          sourceEventId: String(mapped.id),
          fetchedAt,
          raw: mapped,
        });
      }

      page += 1;
    } while (page <= totalPages);

    return results;
  }

  private async fetchWithRetry(url: string): Promise<TribeEventsApiResponse> {
    const maxAttempts = 3;
    let attempt = 0;
    let lastError: unknown;

    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'CommunityAPI/1.0 (+https://github.com/jgeibel/community-api)',
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(`Failed to fetch Tribe Events API (status ${response.status}): ${body}`);
        }

        return (await response.json()) as TribeEventsApiResponse;
      } catch (error) {
        lastError = error;
        const delay = attempt * 250;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Unknown error fetching Tribe Events API');
  }

  private mapEvent(item: TribeEventsApiEvent, fetchedUrl: string): TribeEventsRawEvent {
    const categories = Array.isArray(item.categories) ? item.categories.map(category => category.slug) : [];
    const tags = Array.isArray(item.tags) ? item.tags.map(tag => tag.slug) : [];
    const organizers = this.normalizeOrganizers(item);
    const venue = this.normalizeVenue(item);

    return {
      id: item.id,
      title: item.title,
      description: item.description,
      status: item.status,
      startDate: item.start_date,
      endDate: item.end_date,
      utcStartDate: item.utc_start_date,
      utcEndDate: item.utc_end_date,
      timezone: item.timezone,
      allDay: Boolean(item.all_day),
      cost: item.cost,
      website: item.website,
      url: item.url,
      restUrl: item.rest_url,
      categories,
      tags,
      venue,
      organizers,
      modifiedUtc: item.modified_utc ?? item.date_utc ?? undefined,
      fetchedUrl,
      raw: item,
    };
  }

  private normalizeVenue(item: TribeEventsApiEvent): TribeEventsVenueApi | null {
    if (item.venue && !Array.isArray(item.venue)) {
      return item.venue;
    }
    if (Array.isArray(item.venues) && item.venues.length > 0) {
      return item.venues[0];
    }
    if (Array.isArray(item.venue) && item.venue.length > 0) {
      return item.venue[0];
    }
    return null;
  }

  private normalizeOrganizers(item: TribeEventsApiEvent): TribeEventsOrganizerApi[] {
    if (Array.isArray(item.organizers)) {
      return item.organizers;
    }
    if (item.organizer && !Array.isArray(item.organizer)) {
      return [item.organizer];
    }
    if (Array.isArray(item.organizer)) {
      return item.organizer;
    }
    return [];
  }
}
