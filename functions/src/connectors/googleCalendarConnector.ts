import { RawEventPayload } from '../models/event';
import { GoogleCalendarConfig, SourceConnector } from './types';
import { addUtcDays, endOfDayInTimeZone, startOfDayInTimeZone } from '../utils/timezone';

interface CalendarApiEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  status?: string;
  start?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  end?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  organizer?: {
    displayName?: string;
    email?: string;
  };
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  updated?: string;
}

interface CalendarApiResponse {
  items?: GoogleCalendarRawEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export interface GoogleCalendarRawEvent {
  uid: string;
  summary?: string;
  description?: string;
  start?: Date;
  end?: Date;
  isAllDay?: boolean;
  location?: string;
  url?: string;
  categories: string[];
  organizer?: string;
  status?: string;
  timezone?: string;
  updated?: string;
  raw: CalendarApiEvent;
  calendarId: string;
  fetchedUrl: string;
}

export class GoogleCalendarConnector implements SourceConnector<GoogleCalendarRawEvent> {
  private readonly calendarId: string;
  private readonly lookAheadDays = 60;
  private readonly lookBackDays = 1;
  private readonly maxAttempts = 3;
  private readonly apiKey?: string;
  private readonly timeZone: string;

  constructor(config: GoogleCalendarConfig) {
    this.calendarId = config.calendarId;
    this.apiKey = process.env.GOOGLE_CALENDAR_API_KEY;
    this.timeZone = config.timeZone ?? 'America/Los_Angeles';
  }

  get sourceId(): string {
    return `google-calendar:${this.calendarId}`;
  }

  async fetchRawEvents(): Promise<Array<RawEventPayload<GoogleCalendarRawEvent>>> {
    const { timeMin, timeMax } = this.getWindowBounds();
    return this.fetchRawEventsWithin(timeMin, timeMax);
  }

  async fetchRawEventsForDate(date: Date): Promise<Array<RawEventPayload<GoogleCalendarRawEvent>>> {
    const { timeMin, timeMax } = this.getWindowBoundsForDate(date);
    return this.fetchRawEventsWithin(timeMin, timeMax);
  }

  async fetchRawEventsBetween(startDate: Date, endDateExclusive: Date): Promise<Array<RawEventPayload<GoogleCalendarRawEvent>>> {
    const { timeMin, timeMax } = this.getWindowBoundsForRange(startDate, endDateExclusive);
    return this.fetchRawEventsWithin(timeMin, timeMax);
  }

  private async fetchRawEventsWithin(timeMin: string, timeMax: string): Promise<Array<RawEventPayload<GoogleCalendarRawEvent>>> {
    const fetchedAt = new Date().toISOString();

    const occurrences = await this.fetchEventsFromApi(timeMin, timeMax);

    return occurrences.map((event): RawEventPayload<GoogleCalendarRawEvent> => ({
      sourceId: this.sourceId,
      sourceEventId: event.uid,
      fetchedAt,
      raw: {
        ...event,
        calendarId: this.calendarId,
        fetchedUrl: this.buildApiUrl(timeMin, timeMax),
      },
    }));
  }

  private getWindowBounds() {
    const now = new Date();
    const start = addUtcDays(startOfDayInTimeZone(now, this.timeZone), -this.lookBackDays);
    const end = addUtcDays(startOfDayInTimeZone(now, this.timeZone), this.lookAheadDays + 1);
    end.setUTCMilliseconds(end.getUTCMilliseconds() - 1);

    return {
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
    };
  }

  private getWindowBoundsForDate(date: Date) {
    const dayStart = startOfDayInTimeZone(date, this.timeZone);
    const dayEnd = endOfDayInTimeZone(date, this.timeZone);

    return {
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
    };
  }

  private getWindowBoundsForRange(startDate: Date, endDateExclusive: Date) {
    const rangeStart = startOfDayInTimeZone(startDate, this.timeZone);
    const rangeEnd = startOfDayInTimeZone(endDateExclusive, this.timeZone);

    return {
      timeMin: rangeStart.toISOString(),
      timeMax: rangeEnd.toISOString(),
    };
  }

  private buildApiUrl(timeMin: string, timeMax: string, pageToken?: string): string {
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events`;
    const params = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin,
      timeMax,
      maxResults: '2500',
    });

    if (this.timeZone) {
      params.set('timeZone', this.timeZone);
    }

    if (this.apiKey) {
      params.set('key', this.apiKey);
    }

    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    return `${base}?${params.toString()}`;
  }

  private async fetchEventsFromApi(timeMin: string, timeMax: string): Promise<GoogleCalendarRawEvent[]> {
    let pageToken: string | undefined;
    const events: GoogleCalendarRawEvent[] = [];
    let attempt = 0;

    do {
      const url = this.buildApiUrl(timeMin, timeMax, pageToken);
      const response = await this.fetchWithRetry(url, attempt);
      events.push(...(response.items ?? []));
      pageToken = response.nextPageToken;
      attempt += 1;
    } while (pageToken && attempt < 25); // guard against runaway pagination

    return events;
  }

  private async fetchWithRetry(url: string, pageAttempt: number = 0): Promise<CalendarApiResponse> {
    let attempt = 0;
    let lastError: unknown;

    while (attempt < this.maxAttempts) {
      attempt += 1;
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'CommunityDataScraper/1.0 (+https://github.com/jgeibel/community-data-scraper-service)',
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(`Failed to fetch Calendar API (status ${response.status}): ${body}`);
        }

        const json = (await response.json()) as { items?: CalendarApiEvent[]; nextPageToken?: string; nextSyncToken?: string };
        const sanitizedUrl = this.redactApiKey(url);
        const mappedItems = (json.items ?? []).map(item => this.mapApiEvent(item, sanitizedUrl));

        return {
          items: mappedItems,
          nextPageToken: json.nextPageToken,
          nextSyncToken: json.nextSyncToken,
        };
      } catch (error) {
        lastError = error;
        const backoffMs = (attempt + pageAttempt) * 250;
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Unknown error fetching Google Calendar API');
  }

  private mapApiEvent(item: CalendarApiEvent, fetchedUrl: string): GoogleCalendarRawEvent {
    const { start, end, isAllDay, timezone } = this.parseEventTime(item);

    return {
      uid: item.id,
      summary: item.summary ?? undefined,
      description: item.description ?? undefined,
      start,
      end,
      isAllDay,
      location: item.location ?? undefined,
      url: item.htmlLink ?? undefined,
      categories: [],
      organizer: item.organizer?.displayName ?? item.organizer?.email ?? undefined,
      status: item.status ?? undefined,
      updated: item.updated ?? undefined,
      timezone,
      raw: item,
      calendarId: this.calendarId,
      fetchedUrl,
    };
  }

  private parseEventTime(item: CalendarApiEvent) {
    const startInfo = item.start ?? {};
    const endInfo = item.end ?? {};

    const isAllDay = Boolean(startInfo.date && !startInfo.dateTime);
    const timezone = startInfo.timeZone ?? endInfo.timeZone ?? undefined;

    const start = this.parseDateTime(startInfo.dateTime, startInfo.date);
    const end = this.parseDateTime(endInfo.dateTime, endInfo.date);

    return { start, end, isAllDay, timezone };
  }

  private parseDateTime(dateTime?: string, date?: string): Date | undefined {
    if (dateTime) {
      return new Date(dateTime);
    }
    if (date) {
      // Treat all-day dates as midnight local time; use UTC to avoid timezone drift.
      return new Date(`${date}T00:00:00Z`);
    }
    return undefined;
  }

  private redactApiKey(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.searchParams.delete('key');
      return parsed.toString();
    } catch (error) {
      return url;
    }
  }
}
