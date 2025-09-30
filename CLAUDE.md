# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Community Data Scraper Service is a Firebase-based API that ingests community events from Google Calendar feeds, classifies them using LLM + embeddings, and serves them via a REST API with personalized ranking based on user interests.

## Commands

### Development
```bash
# Start Firebase emulators (functions, Firestore, hosting)
npm run serve

# Build TypeScript functions
cd functions && npm run build

# Watch mode for continuous builds
cd functions && npm run build:watch
```

### Deployment
```bash
# Deploy everything (functions, Firestore rules/indexes, hosting)
npm run deploy

# Deploy only functions
cd functions && npm run deploy

# Deploy only Firestore rules and indexes
firebase deploy --only firestore

# Deploy only hosting
firebase deploy --only hosting
```

### Testing & Monitoring
```bash
# View function logs
npm run logs

# Manually trigger event sync (all calendars)
curl "https://us-central1-community-data-scraper-service.cloudfunctions.net/triggerCommunityEventsSync"

# Manually trigger sync for a specific date
curl "https://us-central1-community-data-scraper-service.cloudfunctions.net/triggerCommunityEventsSyncForDay?date=2025-09-29"

# Manually trigger sync with custom parameters
curl "https://us-central1-community-data-scraper-service.cloudfunctions.net/triggerCommunityEventsSync?start=2025-09-29&days=7&chunkSize=2&forceRefresh=true"

# Clear and rescrape all data
./scripts/clear-and-rescrape.sh
```

### API Testing
```bash
# Get events feed (requires API key)
curl -H "X-API-Key: 05413fbc45028b7295bbc6cffbdc506829b3c3457039c06dbc2ff6f54ea79348" \
  "https://us-central1-community-data-scraper-service.cloudfunctions.net/api/feed?start=2025-09-29&days=7"

# Get feed with tag filtering
curl -H "X-API-Key: 05413fbc45028b7295bbc6cffbdc506829b3c3457039c06dbc2ff6f54ea79348" \
  "https://us-central1-community-data-scraper-service.cloudfunctions.net/api/feed?tags=yoga,fitness"

# Get feed with user personalization
curl -H "X-API-Key: 05413fbc45028b7295bbc6cffbdc506829b3c3457039c06dbc2ff6f54ea79348" \
  "https://us-central1-community-data-scraper-service.cloudfunctions.net/api/feed?userId=user123"

# Get tag proposals
curl -H "X-API-Key: 05413fbc45028b7295bbc6cffbdc506829b3c3457039c06dbc2ff6f54ea79348" \
  "https://us-central1-community-data-scraper-service.cloudfunctions.net/api/tag-proposals?limit=50"
```

## Architecture

### Data Flow

1. **Ingestion** (`syncCommunityEvents` scheduled function, runs every 30 minutes)
   - Fetches events from Google Calendar feeds (via `GoogleCalendarConnector`)
   - Chunks date ranges (default: 7-day chunks, 1 day lookback + 60 days lookahead)
   - Normalizes raw calendar events into canonical format (`CanonicalEvent`)
   - Generates embeddings for event title + description (OpenAI text-embedding-3-small)
   - Classifies events with LLM to extract tags (`EventTagClassifier`)
   - Records tag proposals for vocabulary expansion (`TagProposalService`)
   - Stores in Firestore `events` collection with deduplication logic

2. **Classification Pipeline**
   - **Embeddings**: OpenAI text-embedding-3-small (1536 dimensions) for semantic search
   - **LLM**: OpenAI GPT-4o-mini generates 1-5 interest tags per event with confidence scores
   - **Tag Proposals**: Tracks tag co-occurrence to build dynamic vocabulary (stored in `tagProposals` collection)
   - **Reuse Logic**: Skips re-classification if Google Calendar `updated` timestamp hasn't changed

3. **API Layer** (`functions/src/api/routes.ts`)
   - **Chronological Mode** (default): Returns events ordered by `startTime`
   - **Personalized Mode** (when `userId` provided):
     - Loads user interest vectors from `profiles/{userId}`
     - Computes cosine similarity between event vector and all user interest vectors
     - Returns events ranked by max similarity score
   - **Pagination**: Supports `pageSize` and `pageToken` parameters

### Key Collections

- **`events`**: Canonical event documents with fields:
  - `startTime`, `endTime` (Firestore Timestamps)
  - `tags` (string array of slugified interest tags)
  - `vector` (1536-dim embedding array)
  - `classification` (metadata about LLM/embedding classification)
  - `rawSnapshot` (original Google Calendar data for change detection)

- **`profiles`**: User preference documents with structure:
  ```typescript
  {
    interests: {
      "yoga": { tag: "yoga", name: "Yoga", vector: [1536-dim array], keywords: [] },
      "hiking": { tag: "hiking", name: "Hiking", vector: [...], keywords: [] }
    },
    updatedAt: Timestamp
  }
  ```

- **`tagProposals`**: Tracks tag suggestions and co-occurrence for vocabulary refinement

### Function Organization

- **`functions/src/index.ts`**: Exports all Cloud Functions (scheduled, HTTP triggers)
- **`functions/src/workers/`**: Background job logic (calendar ingestion)
- **`functions/src/classification/`**: LLM and embedding providers
- **`functions/src/connectors/`**: External data source adapters (Google Calendar)
- **`functions/src/normalizers/`**: Transform raw data to canonical format
- **`functions/src/services/`**: Core business logic (event storage, tag proposals)
- **`functions/src/api/`**: Express routes for REST API
- **`functions/src/models/`**: TypeScript interfaces for domain objects

### Environment Configuration

- **`.env.local`**: Local development environment variables
  - `OPENAI_API_KEY`: Required for embeddings and LLM classification
  - `ENABLE_CLASSIFICATION_DEBUG`: Set to `true` to log full LLM prompts/responses for debugging bad tags
  - Loaded automatically by Firebase Functions during emulator runs

- **Firebase Console**: Production environment variables set in Cloud Functions configuration
  - Navigate to Functions → Configuration in Firebase Console
  - Add `OPENAI_API_KEY` as secret
  - Add `ENABLE_CLASSIFICATION_DEBUG=true` temporarily when debugging production issues

### Firestore Indexes

Required composite indexes are defined in `firestore.indexes.json`:
- `events`: `(startTime ASC, __name__ ASC)` for chronological pagination
- `events`: `(startTime ASC, tags ARRAY)` for filtered queries

### Authentication

API endpoints require `X-API-Key` header (middleware in `functions/src/middleware/auth.ts`). Current key: `05413fbc45028b7295bbc6cffbdc506829b3c3457039c06dbc2ff6f54ea79348`

### Timezone Handling

All event times are stored in UTC. Utilities in `functions/src/utils/timezone.ts` handle conversion from Pacific timezone (America/Los_Angeles) to UTC for date range queries.

### Change Detection & Efficiency

- Events are only re-classified if the Google Calendar `updated` timestamp has changed
- Uses `lastFetchedAt` and `lastSeenAt` timestamps to track staleness
- `forceRefresh=true` query parameter bypasses change detection for manual re-ingestion

### Tag Proposal System

The service builds an open vocabulary of interest tags:
1. LLM generates multi-word interest tags for each event during ingestion (e.g., "community gardening", "youth soccer")
2. Tags are slugified (e.g., "community-gardening") and stored in `tagProposals` collection with occurrence counts
3. **Important**: The proposal system uses tags directly from the LLM classifier, NOT by tokenizing event text
4. `/api/tag-proposals` endpoint returns top N proposals for UI autocomplete
5. Users can select from proposals or enter custom interests (converted to embeddings)

### Debugging Tag Quality

When bad tags are generated (e.g., "permission", "recommended" instead of actual interests):

1. **Enable debug logging**:
   ```bash
   # In .env.local, set:
   ENABLE_CLASSIFICATION_DEBUG=true
   ```

2. **Trigger a sync to see full prompts/responses**:
   ```bash
   # Start emulators with debug mode
   npm run serve

   # In another terminal, trigger sync for a specific date
   curl "http://localhost:5001/community-data-scraper-service/us-central1/triggerCommunityEventsSyncForDay?date=2025-09-29&forceRefresh=true"
   ```

3. **Review logs** for `[CLASSIFICATION_DEBUG]` entries containing:
   - Full prompt sent to OpenAI
   - Event title and description
   - LLM JSON response
   - Extracted tags with confidence scores

4. **Iterate on the prompt** in `functions/src/classification/llm.ts:buildPrompt()`:
   - Current prompt emphasizes "interest themes" and "activity, topic, or audience"
   - May need stronger filtering language: "actionable interests" or "noun phrases only"
   - Consider adding negative examples: "Do NOT include: adjectives (recommended), verbs (permission), meta-terms"

5. **Add stop words** to `THEME_STOP_WORDS` set in `functions/src/tags/proposalService.ts` for common bad tags

6. **Rebuild and redeploy**:
   ```bash
   cd functions && npm run build
   firebase deploy --only functions
   ```