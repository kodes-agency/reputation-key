# Phase 10 — Reviews & Google Integration Architecture

Implementation plan from grilling session (Q1–Q33). All architectural decisions finalized.

## Task breakdown

### T1. DB Schema — reviews & replies tables
**Files:** `src/shared/db/schema/review.schema.ts`, `src/shared/db/schema/index.ts`

Create `src/shared/db/schema/review.schema.ts`:
- `reviewPlatformEnum` = `pgEnum('review_platform', ['google'])`
- `replyStatusEnum` = `pgEnum('reply_status', ['draft', 'pending_approval', 'approved', 'published', 'rejected'])`
- `replySourceEnum` = `pgEnum('reply_source', ['google_sync', 'internal'])`
- `reviews` table (see schema below)
- `replies` table (see schema below)

Update `src/shared/db/schema/index.ts` — add `export * from './review.schema'`

**reviews table:**
```
pgTable('reviews', {
  id: uuid PK defaultRandom(),
  organizationId: varchar(255) notNull(),
  propertyId: uuid notNull().references(properties.id, onDelete cascade),
  platform: reviewPlatformEnum notNull(),
  externalId: varchar(500) notNull(),
  externalLocationId: varchar(500) notNull(),
  googleConnectionId: uuid references(google_connections.id),
  reviewerName: varchar(255),
  reviewerProfilePhotoUrl: varchar(1000),
  rating: integer notNull(),
  text: text,
  languageCode: varchar(10),
  reviewedAt: timestamp(tz) notNull(),
  expiresAt: timestamp(tz) notNull(),
  sentimentLabel: varchar(20),
  sentimentScore: real,
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
})
indexes:
  - uniqueIndex('reviews_platform_external_unique').on(platform, externalId)
  - index('reviews_property_idx').on(propertyId)
  - index('reviews_org_idx').on(organizationId)
```

**replies table:**
```
pgTable('replies', {
  id: uuid PK defaultRandom(),
  reviewId: uuid notNull().references(reviews.id, onDelete cascade),
  organizationId: varchar(255) notNull(),
  text: text notNull(),
  status: replyStatusEnum notNull(),
  source: replySourceEnum notNull(),
  createdBy: varchar(255),
  publishedAt: timestamp(tz),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
})
indexes:
  - index('replies_review_idx').on(reviewId)
  - index('replies_org_idx').on(organizationId)
```

### T2. DB Schema — drop 'reviews' from gbp_cache enum
**File:** `src/shared/db/schema/gbp-cache.schema.ts`

Change `gbpCacheDataTypeEnum` from `['location', 'reviews']` to `['location']`.

**Requires Drizzle migration.** Run `pnpm drizzle-kit generate` after T1+T2. Use `drizzle-better-auth` skill for migration workflow.

### T3. Branded IDs — ReviewId, ReplyId
**File:** `src/shared/domain/ids.ts`

Add:
```ts
export type ReviewId = Brand<string, 'ReviewId'>
export type ReplyId = Brand<string, 'ReplyId'>
export function reviewId(id: string): ReviewId { return id as ReviewId }
export function replyId(id: string): ReplyId { return id as ReplyId }
```

Remove comment `// ReviewId — deferred to Phase 8/9`.

### T4. Review context — domain types
**File:** `src/contexts/review/domain/types.ts` (new)

```ts
import type { ReviewId, ReplyId, PropertyId, OrganizationId, GoogleConnectionId } from '#/shared/domain/ids'

export type ReviewPlatform = 'google'

export type Review = Readonly<{
  id: ReviewId
  organizationId: OrganizationId
  propertyId: PropertyId
  platform: ReviewPlatform
  externalId: string
  externalLocationId: string
  googleConnectionId: GoogleConnectionId | null
  reviewerName: string | null
  reviewerProfilePhotoUrl: string | null
  rating: number
  text: string | null
  languageCode: string | null
  reviewedAt: Date
  expiresAt: Date
  sentimentLabel: string | null
  sentimentScore: number | null
  createdAt: Date
  updatedAt: Date
}>

export type ReplyStatus = 'draft' | 'pending_approval' | 'approved' | 'published' | 'rejected'
export type ReplySource = 'google_sync' | 'internal'

export type Reply = Readonly<{
  id: ReplyId
  reviewId: ReviewId
  organizationId: OrganizationId
  text: string
  status: ReplyStatus
  source: ReplySource
  createdBy: string | null
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}>

/** Raw review data from Google API, before domain mapping */
export type GoogleReview = Readonly<{
  reviewName: string        // accounts/{a}/locations/{l}/reviews/{r}
  externalId: string        // the review ID portion
  externalLocationId: string
  reviewerName: string | null
  reviewerProfilePhotoUrl: string | null
  rating: number            // 1-5
  text: string | null
  languageCode: string | null
  reviewedAt: Date
  replyText: string | null  // Google's reply, if any
  replyUpdatedAt: Date | null
}>
```

### T5. Review context — domain errors
**File:** `src/contexts/review/domain/errors.ts` (new)

```ts
import { createErrorFactory } from '#/shared/domain/errors'

export type ReviewErrorCode =
  | 'unauthorized'
  | 'property_not_found'
  | 'connection_not_found'
  | 'connection_inactive'
  | 'sync_failed'
  | 'invalid_rating'
  | 'review_not_found'
  | 'reply_not_found'
  | 'reply_already_exists'

export type ReviewError = Readonly<{
  _tag: 'ReviewError'
  code: ReviewErrorCode
  message: string
  context?: Record<string, unknown>
}>

export const reviewError = createErrorFactory<ReviewError>('ReviewError')
export const isReviewError = (e: unknown): e is ReviewError =>
  typeof e === 'object' && e !== null && (e as ReviewError)._tag === 'ReviewError'
```

### T6. Review context — domain events
**File:** `src/contexts/review/domain/events.ts` (new)

```ts
import type { ReviewId, PropertyId, OrganizationId } from '#/shared/domain/ids'

export type ReviewCreated = Readonly<{
  _tag: 'review.created'
  reviewId: ReviewId
  propertyId: PropertyId
  organizationId: OrganizationId
  platform: 'google'
  externalId: string
  rating: number
  occurredAt: Date
}>

export type ReviewUpdated = Readonly<{
  _tag: 'review.updated'
  reviewId: ReviewId
  propertyId: PropertyId
  organizationId: OrganizationId
  platform: 'google'
  externalId: string
  rating: number
  occurredAt: Date
}>

export type ReviewExpired = Readonly<{
  _tag: 'review.expired'
  reviewId: ReviewId
  propertyId: PropertyId
  organizationId: OrganizationId
  occurredAt: Date
}>

export type ReviewEvent = ReviewCreated | ReviewUpdated | ReviewExpired

// Constructors
export const reviewCreated = (args: Omit<ReviewCreated, '_tag'>): ReviewCreated =>
  ({ _tag: 'review.created', ...args })

export const reviewUpdated = (args: Omit<ReviewUpdated, '_tag'>): ReviewUpdated =>
  ({ _tag: 'review.updated', ...args })

export const reviewExpired = (args: Omit<ReviewExpired, '_tag'>): ReviewExpired =>
  ({ _tag: 'review.expired', ...args })
```

### T7. Master event union — add ReviewEvent
**File:** `src/shared/events/events.ts`

Add review context events section:
```ts
// Review context events
export type {
  ReviewEvent,
  ReviewCreated,
  ReviewUpdated,
  ReviewExpired,
} from '#/contexts/review/domain/events'
```

Add to `DomainEvent` union:
```ts
import type { ReviewEvent } from '#/contexts/review/domain/events'
export type DomainEvent = ... | ReviewEvent
```

### T8. Review context — repository ports
**Files:** `src/contexts/review/application/ports/review.repository.ts`, `reply.repository.ts` (new)

```ts
// review.repository.ts
import type { Review, ReviewPlatform } from '../../domain/types'
import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'

export type ReviewRepository = Readonly<{
  findByExternalId(platform: ReviewPlatform, externalId: string): Promise<Review | null>
  upsert(review: Omit<Review, 'createdAt' | 'updatedAt'>): Promise<Review>
  findByPropertyId(propertyId: PropertyId): Promise<ReadonlyArray<Review>>
  findByOrganizationId(orgId: OrganizationId): Promise<ReadonlyArray<Review>>
  findExpiringBefore(date: Date): Promise<ReadonlyArray<Review>>
  findExpiredBefore(date: Date): Promise<ReadonlyArray<Review>>
  deleteById(id: ReviewId): Promise<void>
  deleteByPropertyId(propertyId: PropertyId): Promise<void>
}>
```

```ts
// reply.repository.ts
import type { Reply, ReplySource } from '../../domain/types'
import type { ReviewId, ReplyId } from '#/shared/domain/ids'
import type { OrganizationId } from '#/shared/domain/ids'

export type ReplyRepository = Readonly<{
  findByReviewId(reviewId: ReviewId): Promise<ReadonlyArray<Reply>>
  findGoogleSyncByReviewId(reviewId: ReviewId): Promise<Reply | null>
  upsert(reply: Omit<Reply, 'createdAt' | 'updatedAt'>): Promise<Reply>
  deleteById(id: ReplyId): Promise<void>
  deleteByReviewIdAndSource(reviewId: ReviewId, source: ReplySource): Promise<void>
}>
```

### T9. Review context — GoogleReviewApiPort
**File:** `src/contexts/review/application/ports/google-review-api.port.ts` (new)

```ts
import type { GoogleReview } from '../../domain/types'

/** Facade port — takes connectionId, returns typed reviews. Pagination handled internally. */
export type GoogleReviewApiPort = Readonly<{
  fetchReviews: (connectionId: string, locationName: string) => Promise<ReadonlyArray<GoogleReview>>
  replyToReview: (connectionId: string, reviewName: string, text: string) => Promise<void>
}>
```

### T10. Review context — queue port
**File:** `src/contexts/review/application/ports/review-queue.port.ts` (new)

```ts
export type SyncPropertyReviewsJobData = Readonly<{
  propertyId: string
  organizationId: string
  connectionId: string
  locationName: string
}>

export type ReviewQueuePort = Readonly<{
  addSyncJob(data: SyncPropertyReviewsJobData): Promise<string> // returns jobId
}>
```

### T11. Review context — sync-reviews use case
**File:** `src/contexts/review/application/use-cases/sync-reviews.ts` (new)

Factory function. Deps: `reviewRepo`, `replyRepo`, `googleReviewApi`, `events`, `clock`, `idGen`.

Logic:
1. Call `googleReviewApi.fetchReviews(connectionId, locationName)`
2. For each GoogleReview:
   a. Check if review exists via `reviewRepo.findByExternalId('google', externalId)`
   b. Build Review domain object (set `expiresAt = now() + 30 days`)
   c. `reviewRepo.upsert(review)` — upserts Google-sourced fields
   d. Mirror reply state:
      - If `googleReview.replyText` exists → upsert reply with `source='google_sync'`, `status='published'`
      - If `googleReview.replyText` is null → delete existing `google_sync` reply for this review
   e. Emit `review.created` or `review.updated` event
3. Return counts: `{ fetched, created, updated, repliesMirrored }`

### T12. Review context — repository implementations
**Files:** `src/contexts/review/infrastructure/repositories/review.repository.ts`, `reply.repository.ts` (new)

Drizzle implementations. Follow pattern from `property/infrastructure/repositories/property.repository.ts`:
- Inject `Database`
- Use Drizzle query builder
- `upsert` uses `onConflictDoUpdate` targeting `reviews_platform_external_unique`
- Reply upsert: find existing `google_sync` reply by reviewId + source, update or insert

### T13. Review context — mapper
**File:** `src/contexts/review/infrastructure/mappers/review.mapper.ts`, `reply.mapper.ts` (new)

`toDomain(row)` / `toRow(domain)` mappers. Branded ID handling per established pattern.

### T14. Review context — sync job handler
**File:** `src/contexts/review/infrastructure/jobs/sync-property-reviews.job.ts` (new)

BullMQ job handler. Follow `import-property.job.ts` pattern:
```ts
export type SyncPropertyReviewsJobData = {
  propertyId: string
  organizationId: string
  connectionId: string
  locationName: string
}

export const createSyncPropertyReviewsHandler = (deps: {
  reviewRepo: ReviewRepository
  replyRepo: ReplyRepository
  googleReviewApi: GoogleReviewApiPort
  events: EventBus
  clock: () => Date
}) => async (job: Job<SyncPropertyReviewsJobData>) => {
  // validate property exists, connection active, then call syncReviews use case
}
```

### T15. Review context — retention job handlers
**Files:** `src/contexts/review/infrastructure/jobs/refresh-expiring-reviews.job.ts`, `purge-expired-reviews.job.ts` (new)

**refresh-expiring-reviews:**
- Query `reviewRepo.findExpiringBefore(now() + 5 days)`
- Group by `(propertyId, connectionId, locationName)`
- For each property, enqueue `sync-property-reviews` job
- Log count of properties refreshed

**purge-expired-reviews:**
- Query `reviewRepo.findExpiredBefore(now() - 3 days)` (3-day grace)
- Delete reviews, emit `review.expired` events
- Log count purged

### T16. GoogleReviewApiPort adapter (in integration)
**File:** `src/contexts/integration/infrastructure/adapters/google-review-api.adapter.ts` (new)

Standalone adapter implementing `GoogleReviewApiPort` from review context.

`fetchReviews(connectionId, locationName)`:
1. Load connection from `google_connections` by ID
2. Check `status === 'active'`, refresh token if expired (reuse `refreshGoogleToken` use case)
3. Decrypt access token via `TokenEncryptionPort`
4. Call GBP API: `GET accounts/{account}/locations/{location}/reviews` with pagination (do-while loop, pageToken)
5. Map each raw review to `GoogleReview` type
6. Return flat array

`replyToReview(connectionId, reviewName, text)`:
1. Same token resolution
2. `PUT accounts/{a}/locations/{l}/reviews/{r}/reply` with `{ comment: text }`

Deps: `connectionRepo`, `encryption`, `oauthPort`, `refreshTokenUseCase`

### T17. Pub/Sub JWT verifier (in integration)
**File:** `src/contexts/integration/infrastructure/adapters/pubsub-jwt.verifier.ts` (new)

Standalone utility. Validates Google OIDC JWT from Pub/Sub push `Bearer` token:
- Fetch Google's OIDC discovery document → JWKS
- Verify JWT signature, audience (`GBP_WEBHOOK_URL`), issuer (`accounts.google.com`)
- Extract `sub` claim (Google service account)
- Return decoded payload or throw

### T18. Webhook route (in integration)
**File:** `src/contexts/integration/server/gbp-webhook.ts` (new)

API route: `POST /api/webhooks/gbp/notifications`

Flow:
1. Extract `Authorization: Bearer <token>` from headers
2. Verify JWT via `pubsubJwtVerifier`
3. Parse Pub/Sub push body: `{ message: { data: base64, attributes } }`
4. Decode `data` → GBP notification: `{ locationName, reviewName, notificationType }`
5. Lookup property by `gbpPlaceId` extracted from `locationName`
6. If no property found → 200 OK (no-op, not our property)
7. Lookup `googleConnectionId` from property
8. Enqueue `sync-property-reviews` BullMQ job via queue port
9. Return 200 OK

**Note:** This is an API route, NOT a server fn. Follow the OAuth callback pattern — use `getContainer()` directly (exception per architecture rules for webhook routes that bypass auth).

### T19. Review context — build function
**File:** `src/contexts/review/build.ts` (new)

```ts
type ReviewContextDeps = Readonly<{
  db: Database
  events: EventBus
  clock: () => Date
  jobQueue: Queue | undefined
  googleReviewApi: GoogleReviewApiPort  // implemented in integration, wired in composition
}>

export const buildReviewContext = (deps: ReviewContextDeps) => {
  const reviewRepo = createReviewRepository(deps.db)
  const replyRepo = createReplyRepository(deps.db)
  const idGen = () => reviewId(randomUUID())

  const syncReviewsUseCase = syncReviews({
    reviewRepo, replyRepo,
    googleReviewApi: deps.googleReviewApi,
    events: deps.events, clock: deps.clock, idGen,
  })

  // Queue port
  const queuePort: ReviewQueuePort = deps.jobQueue
    ? { addSyncJob: async (data) => { ... } }
    : { addSyncJob: async () => { throw new Error(...) } }

  const useCases = {
    syncReviews: syncReviewsUseCase,
  } as const

  return { useCases, reviewRepo, replyRepo, queuePort } as const
}
```

### T20. Composition root — wire review context
**File:** `src/composition.ts`

1. Import `buildReviewContext`, `GoogleReviewApiPort` type
2. Create `googleReviewApiAdapter` in integration deps (using integration's repos/adapters)
3. Build review context after integration:
```ts
const review = buildReviewContext({
  db, events: eventBus, clock, jobQueue: infra.jobQueue,
  googleReviewApi: createGoogleReviewApiAdapter({
    connectionRepo: /* from integration build */,
    encryption: /* from integration build */,
    oauth: /* from integration build */,
    refreshToken: /* from integration build */,
  }),
})
```
4. Spread review useCases into container's useCases
5. Expose `reviewRepo`, `replyRepo`, `reviewQueuePort` on container

**Challenge:** Integration's internal repos/adapters are currently private to `buildIntegrationContext`. Options:
- **A.** Export the adapter factory + repos from integration build return value
- **B.** Create the google-review-api adapter in composition.ts using shared DB

**Recommendation: A** — export what's needed from integration build. Add `connectionRepo`, `encryption`, `oauthPort`, `refreshToken` to integration's return object. Keeps adapter in integration context.

### T21. Bootstrap — register review job handlers
**File:** `src/bootstrap.ts`

Register three job handlers:
```ts
// Review sync job
container.jobRegistry.register('sync-property-reviews', async (job) => {
  await syncPropertyReviewsHandler(job as Job<SyncPropertyReviewsJobData>)
})

// Retention jobs
container.jobRegistry.register('refresh-expiring-reviews', async (job) => { ... })
container.jobRegistry.register('purge-expired-reviews', async (job) => { ... })
```

### T22. Worker — schedule retention jobs
**File:** `src/worker/index.ts`

After health-check scheduling, add:
```ts
container.jobQueue?.add('refresh-expiring-reviews', {}, {
  repeat: { every: 24 * 60 * 60 * 1000 },
  jobId: 'refresh-expiring-reviews-recurring',
}).catch(...)

container.jobQueue?.add('purge-expired-reviews', {}, {
  repeat: { every: 24 * 60 * 60 * 1000 },
  jobId: 'purge-expired-reviews-recurring',
}).catch(...)
```

### T23. Event handler — auto-sync on property import
**File:** `src/contexts/review/infrastructure/event-handlers/property-imported.handler.ts` (new)

Subscribe to `property.created` event (from integration's `PropertyImportCompleted`):
1. Check if any property with this `connectionId` already existed (for first-import subscription check)
2. If first property for this connection → subscribe to Pub/Sub notifications
3. Always enqueue `sync-property-reviews` job

Register in `bootstrap.ts`:
```ts
container.eventBus.on('property_import.completed', async (event) => {
  // enqueue initial sync
  container.reviewQueuePort.addSyncJob({ ... })
})
```

### T24. Event handler — unsubscribe on last property delete
**File:** `src/contexts/integration/infrastructure/event-handlers/property-deleted.handler.ts` (new)

Subscribe to `property.deleted`:
1. Count remaining properties with this `googleConnectionId`
2. If 0 → call Google Notifications API to unsubscribe
3. If connection was disconnected → already handled by cascade

Register in `bootstrap.ts`.

### T25. Review context — public API
**File:** `src/contexts/review/application/public-api.ts` (new)

```ts
export type { Review, Reply, GoogleReview, ReviewPlatform, ReplyStatus, ReplySource } from '../domain/types'
export type { ReviewId, ReplyId } from '#/shared/domain/ids'
```

For component imports per ESLint boundary rules.

### T26. Review context — barrel exports
**Files:** `src/contexts/review/index.ts`, barrel exports in each subdirectory

Standard barrel pattern matching existing contexts.

## Execution order

```
T1 (schema)  ──────────────────────┐
T2 (drop reviews from gbp_cache) ──┤
T3 (branded IDs) ──────────────────┤
│                                   ▼
│                              Migration (drizzle-kit generate + migrate)
│
T4 (domain types) ──────────────── depends on T3
T5 (domain errors) ────────────── standalone
T6 (domain events) ────────────── depends on T3
T7 (master event union) ───────── depends on T6
T8 (repo ports) ───────────────── depends on T4
T9 (GoogleReviewApiPort) ─────── depends on T4
T10 (queue port) ──────────────── standalone
T11 (sync use case) ───────────── depends on T8, T9, T6
T12 (repo impls) ──────────────── depends on T8, T1 (migration)
T13 (mappers) ──────────────────── depends on T4, T1
T14 (sync job handler) ────────── depends on T11
T15 (retention jobs) ──────────── depends on T8
T16 (review API adapter) ──────── depends on T9, integration repos
T17 (JWT verifier) ────────────── standalone
T18 (webhook route) ───────────── depends on T17, T10
T19 (review build) ────────────── depends on T11, T12, T14, T15
T20 (composition) ─────────────── depends on T19, T16, integration build
T21 (bootstrap) ────────────────── depends on T14, T15
T22 (worker scheduling) ───────── depends on T21
T23 (auto-sync handler) ───────── depends on T10
T24 (unsubscribe handler) ─────── depends on integration
T25 (public API) ──────────────── depends on T4
T26 (barrel exports) ──────────── last
```

## Migration strategy

T1+T2 change DB schema. After implementing those two:
1. Run `pnpm drizzle-kit generate` — produces migration SQL
2. Review generated SQL (should create tables + alter enum)
3. Run `pnpm drizzle-kit migrate` — applies to dev DB
4. Verify with `pnpm drizzle-kit push` or manual inspection

Use `drizzle-better-auth` skill for the migration workflow.

## Context.md already updated

- `CONTEXT.md` — Integration + Review contexts, glossary
- `src/contexts/CONTEXT.md` — updated context catalog
- `src/contexts/review/CONTEXT.md` — review context glossary (created during grilling)
- `src/contexts/integration/CONTEXT.md` — narrowed scope
- `docs/adr/0003-review-bounded-context.md` — ADR created

## Out of scope (Phase 11+)

- Review inbox UI (Phase 11)
- Reply workflow: draft → approve → reject → publish (Phase 12)
- AI sentiment analysis (Arc 7)
- `review.deleted` event handler (future)
- TripAdvisor integration (future)
