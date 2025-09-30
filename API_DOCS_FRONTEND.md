# Community Feed API - Front-End Documentation

## Overview

This API powers a **TikTok-style community feed** that learns user preferences through behavioral interactions. The system delivers personalized content (events, flash offers, polls, requests, photos) by tracking what users view, like, share, and dismiss.

**Key Concepts:**
- **Behavioral Learning**: No upfront profile setup required. The system learns from user actions.
- **Mixed Content Types**: Feed includes events, flash offers, polls, requests, photos, announcements.
- **Personalization Threshold**: After 20+ interactions, feed becomes personalized. Before that, chronological.
- **Exploration/Exploitation**: 80% personalized content, 20% random discovery to avoid filter bubbles.

---

## Base URL

```
Production: https://us-central1-community-data-scraper-service.cloudfunctions.net/api
Mock Data:  https://us-central1-community-data-scraper-service.cloudfunctions.net/api/mock
```

**Front-end switching pattern:**
```typescript
const API_BASE = import.meta.env.VITE_USE_MOCK
  ? 'https://us-central1-community-data-scraper-service.cloudfunctions.net/api/mock'
  : 'https://us-central1-community-data-scraper-service.cloudfunctions.net/api';
```

---

## Authentication

**Production endpoints** (`/api/*`) require an API key header:

```http
X-API-Key: your-api-key-here
```

**Mock endpoints** (`/api/mock/*`) do not require authentication for faster development iteration.

---

## Mock Data API

The `/api/mock/*` endpoints provide rich, pre-seeded content for front-end development and testing. They support **two modes**:

### Mode 1: Mock Personas (Pure Mock)
Pre-defined users with instant personalization, no database writes.

**Available Personas:**
- `mock-foodie` - Loves food, restaurants, cooking, deals
- `mock-parent` - Focused on family, kids, education
- `mock-fitness` - Enthusiast for sports, yoga, wellness
- `mock-culture` - Passionate about music, arts, theater
- `mock-explorer` - Balanced interests across all categories

**Usage:**
```typescript
const response = await fetch(`${API_BASE}/feed?userId=mock-foodie&pageSize=20`);
// Returns instantly personalized feed based on persona, no DB calls
```

### Mode 2: Hybrid Mode (Real Profile + Mock Content)
Use your real userId with mock content to build an actual profile in Firestore.

**Usage:**
```typescript
const response = await fetch(`${API_BASE}/feed?userId=user-jgeibel-123&pageSize=20`);
// Returns mock content ranked by your REAL profile (built from interactions)

// Record interactions - these ARE saved to Firestore
await fetch(`${API_BASE}/interactions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 'user-jgeibel-123',  // Real user
    contentId: 'mock-event-1',
    contentType: 'event',
    action: 'liked',
    context: { ... },
  })
});
```

**Benefits:**
- ✅ Test personalization algorithm with curated content
- ✅ Build your own profile by swiping through mock items
- ✅ Team members can each have distinct profiles on same content
- ✅ No Firebase auth needed for quick UI iteration
- ✅ 30+ diverse content items across all types (events, flash-offers, polls, requests)

---

## Endpoints

### 1. GET `/api/feed` - Get Personalized Feed

Retrieves a personalized feed of community content ranked by relevance to the user.

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `userId` | string | - | **Required for personalization.** Unique user identifier. |
| `pageSize` | number | 20 | Items per page (max 50). |
| `pageToken` | string | - | Pagination token from previous response. |
| `start` | string (ISO date) | today | Start date for time-based content (e.g., "2025-01-15"). |
| `days` | number | 1 | Number of days to fetch (max 31). |
| `tags` | string (comma-separated) | - | Filter by tags (e.g., "food,music"). Max 10 tags. |

#### Request Example

```typescript
// Initial load (no userId = chronological)
const response = await fetch(
  `${API_BASE}/api/feed?pageSize=20&start=2025-01-15&days=7`,
  {
    headers: {
      'X-API-Key': API_KEY,
    },
  }
);

// Personalized feed (with userId)
const response = await fetch(
  `${API_BASE}/api/feed?userId=user-abc-123&pageSize=20`,
  {
    headers: {
      'X-API-Key': API_KEY,
    },
  }
);
```

#### Response

```typescript
{
  count: number;
  events: FeedItem[];           // Array of content items
  nextPageToken: string | null; // Use for pagination
  window: {
    start: string;              // ISO timestamp
    end: string;                // ISO timestamp
  };
  personalized: boolean;        // true if user has enough interaction history
}
```

#### FeedItem Schema

```typescript
interface FeedItem {
  id: string;
  title: string;
  startTime: string | null;     // ISO timestamp (for events)
  endTime: string | null;        // ISO timestamp (for events)
  tags: string[];                // Interest tags (e.g., ["food", "flash-deal", "bargain-hunters"])
  contentType: ContentType;      // Type of content
  score: number;                 // Relevance score (0-1, higher = more relevant)
  source: {
    sourceId: string;
    sourceEventId: string;
    sourceUrl?: string;
  } | null;
  classification: {
    tags: string[];
    candidates: Array<{
      tag: string;
      confidence: number;
      rationale?: string;
    }>;
    metadata?: Record<string, unknown>;
  } | null;
}

type ContentType =
  | 'event'          // Scheduled community events
  | 'flash-offer'    // Time-limited deals
  | 'poll'           // Community polls
  | 'request'        // Help requests, offers
  | 'photo'          // Community photos
  | 'announcement';  // General announcements
```

#### Pagination Example

```typescript
let allItems: FeedItem[] = [];
let pageToken: string | null = null;

do {
  const url = new URL(`${API_BASE}/api/feed`);
  url.searchParams.set('userId', userId);
  url.searchParams.set('pageSize', '20');
  if (pageToken) {
    url.searchParams.set('pageToken', pageToken);
  }

  const response = await fetch(url, {
    headers: { 'X-API-Key': API_KEY },
  });

  const data = await response.json();
  allItems = allItems.concat(data.events);
  pageToken = data.nextPageToken;
} while (pageToken);
```

---

### 2. POST `/api/interactions` - Record User Interaction

Tracks user actions to build behavioral profile. **Call this endpoint every time the user interacts with content.**

#### Request Body

```typescript
interface CreateInteractionInput {
  userId: string;                   // User identifier
  contentId: string;                // ID of the content item
  contentType: ContentType;         // Type of content
  action: InteractionAction;        // What the user did
  dwellTime?: number;               // Seconds spent viewing (optional)
  context: InteractionContext;      // Session context
  contentTags?: string[];           // Tags (auto-fetched if omitted)
}

type InteractionAction =
  | 'viewed'          // User saw this item in feed
  | 'liked'           // User hearted/liked
  | 'shared'          // User shared
  | 'bookmarked'      // User saved for later
  | 'dismissed'       // User swiped away
  | 'not-interested'  // User explicitly said "not interested"
  | 'attended'        // User attended event (post-event)
  | 'engaged'         // User voted in poll, replied to request, etc.
  | 'commented';      // User commented

interface InteractionContext {
  position: number;                 // Position in feed (0-based)
  sessionId: string;                // Unique session ID (generate on app open)
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  dayOfWeek: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
}
```

#### Request Example

```typescript
// Track that user viewed an item
await fetch(`${API_BASE}/api/interactions`, {
  method: 'POST',
  headers: {
    'X-API-Key': API_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    userId: 'user-abc-123',
    contentId: 'event-xyz-789',
    contentType: 'event',
    action: 'viewed',
    dwellTime: 3.5,              // User scrolled past after 3.5 seconds
    context: {
      position: 5,               // This was the 6th item in feed
      sessionId: 'session-12345',
      timeOfDay: 'evening',
      dayOfWeek: 'monday',
    },
  }),
});

// Track that user liked an item
await fetch(`${API_BASE}/api/interactions`, {
  method: 'POST',
  headers: {
    'X-API-Key': API_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    userId: 'user-abc-123',
    contentId: 'event-xyz-789',
    contentType: 'event',
    action: 'liked',
    context: {
      position: 5,
      sessionId: 'session-12345',
      timeOfDay: 'evening',
      dayOfWeek: 'monday',
    },
  }),
});
```

#### Response

```typescript
{
  success: boolean;
  interactionId: string;
}
```

---

### 3. POST `/api/interactions/batch` - Bulk Record Interactions

Record multiple interactions at once for performance. Use this when user scrolls through many items quickly.

#### Request Body

```typescript
{
  interactions: CreateInteractionInput[];  // Max 100 interactions
}
```

#### Request Example

```typescript
await fetch(`${API_BASE}/api/interactions/batch`, {
  method: 'POST',
  headers: {
    'X-API-Key': API_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    interactions: [
      {
        userId: 'user-abc-123',
        contentId: 'event-1',
        contentType: 'event',
        action: 'viewed',
        dwellTime: 2.1,
        context: { position: 0, sessionId: 'session-12345', timeOfDay: 'evening', dayOfWeek: 'monday' },
      },
      {
        userId: 'user-abc-123',
        contentId: 'event-2',
        contentType: 'event',
        action: 'viewed',
        dwellTime: 1.8,
        context: { position: 1, sessionId: 'session-12345', timeOfDay: 'evening', dayOfWeek: 'monday' },
      },
      // ... up to 100 items
    ],
  }),
});
```

#### Response

```typescript
{
  success: boolean;
  count: number;                  // Number of interactions recorded
  interactionIds: string[];       // IDs of created interactions
}
```

---

## Front-End Implementation Guide

### Recommended UX Flow

#### 1. **App Launch - Minimal Onboarding**

```typescript
// On first launch, ask ONE simple question (optional)
const onboarding = async (userId: string) => {
  const interest = await showOnboardingPrompt(
    "What brings you here?",
    ["Social Events", "Food & Dining", "Sports & Fitness", "Arts & Culture", "Local Deals"]
  );

  // Optional: Store broad preference (for initial seed)
  // But don't require it - user can skip and start scrolling immediately
};
```

**Key Principle:** Get users into the feed ASAP. The system learns from their actions, not upfront surveys.

#### 2. **Feed Display - Infinite Scroll**

```typescript
const FeedScreen: React.FC = () => {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [pageToken, setPageToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const sessionId = useRef(generateSessionId());
  const userId = useAuth().userId;

  const loadMore = async () => {
    if (loading) return;
    setLoading(true);

    const url = new URL(`${API_BASE}/api/feed`);
    url.searchParams.set('userId', userId);
    url.searchParams.set('pageSize', '20');
    url.searchParams.set('days', '7');
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const response = await fetch(url, {
      headers: { 'X-API-Key': API_KEY },
    });

    const data = await response.json();
    setItems(prev => [...prev, ...data.events]);
    setPageToken(data.nextPageToken);
    setLoading(false);
  };

  useEffect(() => {
    loadMore();
  }, []);

  return (
    <FlatList
      data={items}
      renderItem={({ item, index }) => (
        <FeedCard
          item={item}
          position={index}
          sessionId={sessionId.current}
          userId={userId}
        />
      )}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
    />
  );
};
```

#### 3. **Interaction Tracking - Automatic & Manual**

```typescript
const FeedCard: React.FC<{
  item: FeedItem;
  position: number;
  sessionId: string;
  userId: string;
}> = ({ item, position, sessionId, userId }) => {
  const [viewStartTime] = useState(Date.now());
  const hasTrackedView = useRef(false);

  // Track "viewed" when item is visible for >1 second
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!hasTrackedView.current) {
        trackInteraction({
          userId,
          contentId: item.id,
          contentType: item.contentType,
          action: 'viewed',
          dwellTime: (Date.now() - viewStartTime) / 1000,
          context: {
            position,
            sessionId,
            timeOfDay: getTimeOfDay(),
            dayOfWeek: getDayOfWeek(),
          },
        });
        hasTrackedView.current = true;
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, []);

  // Track "liked" when user hearts
  const handleLike = () => {
    trackInteraction({
      userId,
      contentId: item.id,
      contentType: item.contentType,
      action: 'liked',
      context: {
        position,
        sessionId,
        timeOfDay: getTimeOfDay(),
        dayOfWeek: getDayOfWeek(),
      },
    });
  };

  // Track "dismissed" when user swipes away
  const handleDismiss = () => {
    trackInteraction({
      userId,
      contentId: item.id,
      contentType: item.contentType,
      action: 'dismissed',
      context: {
        position,
        sessionId,
        timeOfDay: getTimeOfDay(),
        dayOfWeek: getDayOfWeek(),
      },
    });
  };

  return (
    <Card>
      <Text>{item.title}</Text>
      <IconButton icon="heart" onPress={handleLike} />
      <IconButton icon="close" onPress={handleDismiss} />
    </Card>
  );
};
```

#### 4. **Helper Functions**

```typescript
// Generate unique session ID on app open
const generateSessionId = (): string => {
  return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

// Determine time of day
const getTimeOfDay = (): 'morning' | 'afternoon' | 'evening' | 'night' => {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 22) return 'evening';
  return 'night';
};

// Get current day of week
const getDayOfWeek = (): string => {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days[new Date().getDay()];
};

// Track interaction (with queue for offline support)
const trackInteraction = async (interaction: CreateInteractionInput) => {
  try {
    await fetch(`${API_BASE}/api/interactions`, {
      method: 'POST',
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(interaction),
    });
  } catch (error) {
    // Queue for retry if offline
    console.error('Failed to track interaction', error);
  }
};
```

#### 5. **Session Management**

```typescript
// Create new session on app open
useEffect(() => {
  const sessionId = generateSessionId();
  sessionStorage.setItem('currentSessionId', sessionId);

  // Optional: Track session start
  analytics.logEvent('session_start', { sessionId });

  return () => {
    // Optional: Track session end
    analytics.logEvent('session_end', { sessionId });
  };
}, []);
```

#### 6. **Batch Tracking for Performance**

```typescript
// Queue up "viewed" interactions and send in batches
const interactionQueue = useRef<CreateInteractionInput[]>([]);

const queueInteraction = (interaction: CreateInteractionInput) => {
  interactionQueue.current.push(interaction);

  // Flush queue every 10 items or 5 seconds
  if (interactionQueue.current.length >= 10) {
    flushQueue();
  }
};

const flushQueue = async () => {
  if (interactionQueue.current.length === 0) return;

  const batch = interactionQueue.current.splice(0, 100);

  try {
    await fetch(`${API_BASE}/api/interactions/batch`, {
      method: 'POST',
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ interactions: batch }),
    });
  } catch (error) {
    // Put failed items back in queue
    interactionQueue.current.unshift(...batch);
  }
};

// Flush on app background
useEffect(() => {
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'background') {
      flushQueue();
    }
  });

  return () => subscription.remove();
}, []);
```

---

## Best Practices

### DO ✅

1. **Track every visible item** - Even if user scrolls past without interacting, track as "viewed" with dwell time.
2. **Use batch API for scrolling** - Queue up "viewed" events and send in bulk.
3. **Generate unique session IDs** - Create new session ID on app open, use for all interactions in that session.
4. **Start with no onboarding** - Let users dive into content immediately. System learns from actions.
5. **Show personalization status** - Display badge like "Feed getting smarter! 15/20 interactions" to encourage engagement.
6. **Handle offline gracefully** - Queue interactions and retry when connection restored.

### DON'T ❌

1. **Don't require profile setup** - No "pick 20 interests" onboarding. The system learns by watching.
2. **Don't track only likes** - Track dismissals, views, and dwell time too. Negative signals are crucial.
3. **Don't fetch feed without userId** - Always pass userId (even for new users) so system can start learning immediately.
4. **Don't ignore contentType** - The system learns content-type preferences (poll-lover, deal-hunter). Always include it.
5. **Don't spam the API** - Batch "viewed" interactions. Only send individual tracking for explicit actions (like, share, dismiss).

---

## Personalization Timeline

| Interactions | Feed Behavior | UX Messaging |
|--------------|---------------|--------------|
| 0-5 | Chronological + random sampling | "Discovering your community..." |
| 6-19 | Starting to learn patterns | "Feed learning... (12/20)" |
| 20+ | Fully personalized (80/20 mix) | "Personalized for you" |
| 50+ | High confidence predictions | "Your feed is dialed in!" |

---

## Error Handling

### Common Errors

```typescript
// 400 - Invalid request
{
  error: "userId is required and must be a string"
}

// 401 - Missing/invalid API key
{
  error: "Unauthorized"
}

// 500 - Server error
{
  error: "Failed to fetch feed",
  message: "Detailed error message"
}
```

### Retry Strategy

```typescript
const fetchWithRetry = async (url: string, options: RequestInit, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;

      // Don't retry 4xx errors (client errors)
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`Client error: ${response.status}`);
      }

      // Retry 5xx errors (server errors)
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
        continue;
      }
    } catch (error) {
      if (i === retries - 1) throw error;
    }
  }
};
```

---

## Example: Complete React Implementation

```typescript
import React, { useState, useEffect, useRef } from 'react';

const API_BASE = 'https://us-central1-community-data-scraper-service.cloudfunctions.net/api';
const API_KEY = 'your-api-key-here';

interface FeedScreenProps {
  userId: string;
}

const FeedScreen: React.FC<FeedScreenProps> = ({ userId }) => {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [pageToken, setPageToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [personalized, setPersonalized] = useState(false);
  const sessionId = useRef(generateSessionId());

  const loadFeed = async (append = false) => {
    if (loading) return;
    setLoading(true);

    try {
      const url = new URL(`${API_BASE}/api/feed`);
      url.searchParams.set('userId', userId);
      url.searchParams.set('pageSize', '20');
      url.searchParams.set('days', '7');
      if (pageToken && append) {
        url.searchParams.set('pageToken', pageToken);
      }

      const response = await fetch(url, {
        headers: { 'X-API-Key': API_KEY },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      setItems(prev => append ? [...prev, ...data.events] : data.events);
      setPageToken(data.nextPageToken);
      setPersonalized(data.personalized);
    } catch (error) {
      console.error('Failed to load feed', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFeed();
  }, []);

  const handleRefresh = () => {
    setPageToken(null);
    loadFeed(false);
  };

  return (
    <div>
      <header>
        <h1>Community Feed</h1>
        {personalized && <span>✨ Personalized for you</span>}
      </header>

      <div className="feed">
        {items.map((item, index) => (
          <FeedCard
            key={item.id}
            item={item}
            position={index}
            sessionId={sessionId.current}
            userId={userId}
          />
        ))}
      </div>

      {pageToken && (
        <button onClick={() => loadFeed(true)} disabled={loading}>
          {loading ? 'Loading...' : 'Load More'}
        </button>
      )}
    </div>
  );
};

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export default FeedScreen;
```

---

## Questions?

For technical support or questions about the API, contact the backend team or refer to the main project documentation in `CLAUDE.md`.
