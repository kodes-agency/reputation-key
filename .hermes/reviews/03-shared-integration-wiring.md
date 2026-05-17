# Review: Shared + Integration + Wiring

## Summary

23 files examined. **4 issues found: 0 critical (P0), 1 warning (P1), 3 informational (P2/P3).**

Overall: this changeset is well-executed. Architecture rules are followed, cross-context wiring is clean, schema migrations are consistent, and conventions are generally respected. The one P1 issue is a potential runtime bug that could cause sporadic failures.

## Critical Issues (P0/P1)

### P1 — `createJobQueue` uses shared Redis connection (`maxRetriesPerRequest: 3`) for BullMQ Queue operations

- **File:** `src/shared/jobs/queue.ts` (line 23)
- **Description:** `createJobQueue` calls `getRedis()` which returns a connection configured with `maxRetriesPerRequest: 3`. While BullMQ *Queue* (producer) operations (`.add()`) are technically non-blocking, BullMQ's own documentation recommends that **all** Redis connections used with BullMQ (both Queue and Worker) should have `maxRetriesPerRequest: null`. This is because BullMQ internally uses commands that may retry, and the `maxRetriesPerRequest` setting on ioredis can interfere with BullMQ's own retry/timeout logic, causing jobs to silently fail to enqueue or throw `MaxRetriesPerRequestError` under Redis connection instability.

  The Worker (`createJobWorker` in `src/shared/jobs/worker.ts`) correctly creates a dedicated connection with `maxRetriesPerRequest: null` — but the Queue side does not.

  **Impact:** Under normal conditions this works fine. Under Redis instability (network blips, failover), queue `.add()` calls may throw `MaxRetriesPerRequestError` instead of retrying, causing webhook notifications (line 102 of `notifications.ts`) and manual sync triggers to silently lose jobs.

  **Fix:** Either (a) create a dedicated ioredis connection in `createJobQueue` with `maxRetriesPerRequest: null`, or (b) extract a factory function similar to `createJobWorker`'s connection pattern. The webhook route and the composition root both use this queue for enqueueing — they would both benefit.

## Warnings (P2/P3)

### P2 — Missing `review.purged` event despite being listed in conventions

- **File:** `src/contexts/review/domain/events.ts` (line 40)
- **Description:** The conventions spec explicitly lists `review.purged` as a new event for the review context: *"New events for review context: review.created, review.updated, review.expired, review.purged"*. However, no `ReviewPurged` type exists. The purge job (`purge-expired-reviews.job.ts` line 28) emits `review.expired` instead of a dedicated `review.purged` event.

  This is arguably a reasonable design choice (purging IS the expiration action), but it diverges from the spec. If `review.purged` was intentionally omitted, the conventions should be updated to reflect this. If it was an oversight, the event type should be added and re-exported from `src/shared/events/events.ts`.

  **Severity:** Low — functionally correct but semantically ambiguous. Downstream consumers cannot distinguish between "review expired" (domain event from business logic) and "review purged" (infrastructure cleanup).

### P2 — `pubsub-jwt.verifier.test.ts` does not test JWKS cache invalidation

- **File:** `src/shared/auth/pubsub-jwt.verifier.test.ts`
- **Description:** The conventions require: *"test valid/invalid tokens, expired tokens, JWKS cache invalidation"*. The test file covers valid tokens, audience/issuer validation, missing fields, and error propagation — but has **no test for JWKS cache TTL-based invalidation**. Specifically:
  - No test verifies that after 24 hours, a new JWKS instance is created
  - No test verifies that within 24 hours, the same JWKS instance is reused

  The JWKS cache TTL is a key security feature (key rotation). Without a test, a future refactor could accidentally break the cache invalidation.

  **Note:** Testing this is tricky because `vi.useFakeTimers()` combined with `vi.resetModules()` would be needed. At minimum, a unit test should verify the `jwksCreatedAt` / `JWKS_CACHE_TTL` logic.

### P3 — Webhook route imports `properties` schema directly from `property.schema.ts` instead of barrel

- **File:** `src/routes/api/webhooks/gbp/notifications.ts` (line 10)
- **Description:** `import { properties } from '#/shared/db/schema/property.schema'` — this is a deep import into a specific schema file rather than using the barrel `#/shared/db/schema` or `#/shared/db/schema/business`. While the webhook route is documented as an exception that may import schema + drizzle-orm, using the barrel would be more consistent with how other files import schemas. Minor style issue, not a bug.

## Positive Findings

1. **Cross-context adapter pattern is exemplary.** `google-review-api.adapter.ts` correctly implements `GoogleReviewApiPort` from the review context, uses `RefreshGoogleToken` use case (no duplicate token logic), and maps 429 → `'gbp_api_rate_limited'`. The `.comment` field is used correctly for `reviewReply` (line 101, 126).

2. **Review text extraction is correct.** The adapter uses `(raw.text as { text?: string; ... })?.text` pattern (line 89, 98) matching the convention.

3. **Composition root wiring is clean.** The `createGoogleReviewApiAdapter` is built once and passed to both `buildReviewContext` and the bootstrap job handlers (S15 fix), ensuring a single instance.

4. **Webhook route architecture is correct.** Follows the documented exception pattern: JWT verification → resource lookup → enqueue job → return 200. Uses `getContainer()` and `getDb()` as permitted. Does NOT import use cases, repositories, or domain logic.

5. **Pub/Sub JWT verifier is well-implemented.** JWKS cache TTL (24h), proper issuer/audience verification, `clockTolerance: '30s'`, and graceful null-coalescing for missing payload fields.

6. **Event re-exports are complete.** `GoogleConnectionVisibilityChanged` is re-exported from master events.ts. All review events (`ReviewCreated`, `ReviewUpdated`, `ReviewExpired`) are re-exported. `ReviewEvent` is in the `DomainEvent` union.

7. **Schema changes are consistent.** `gbp_cache_data_type` enum narrowed from `['location', 'reviews']` to `['location']`. Both Drizzle schema and domain type are aligned. Tests updated accordingly. `review.schema.ts` is re-exported from both `business.ts` and `index.ts`.

8. **Tenant isolation comment in gbp-cache schema** (line 32–34) is clear and actionable.

9. **Branded IDs** (`ReviewId`, `ReplyId`) follow the existing `Brand<string, 'XxxId'>` pattern with constructor functions.

10. **Worker shutdown is graceful** — drains worker, then closes queue, then exits. Queue close added in this changeset.

11. **Bootstrap registration is thorough** — all three review job types (`sync-property-reviews`, `refresh-expiring-reviews`, `purge-expired-reviews`) registered with proper dependency injection.

12. **Integration build.ts** correctly exposes `connectionRepo`, `encryptionPort`, `oauthPort`, `refreshGoogleTokenUseCase` for cross-context wiring.

13. **ESLint boundary rules updated** — `shared-events` added to infrastructure allow-list, `shared-other` added to application allow-list. Both are documented with architectural justification.

## Files Reviewed

### New files
- `src/contexts/integration/infrastructure/adapters/google-review-api.adapter.ts`
- `src/routes/api/webhooks/gbp/notifications.ts`
- `src/shared/auth/pubsub-jwt.verifier.ts`
- `src/shared/auth/pubsub-jwt.verifier.test.ts`

### Modified files (full read + diff)
- `src/shared/db/schema/gbp-cache.schema.ts`
- `src/shared/db/schema/business.ts`
- `src/shared/db/schema/index.ts`
- `src/shared/domain/ids.ts`
- `src/shared/events/events.ts`
- `src/shared/config/env.ts`
- `src/contexts/integration/build.ts`
- `src/contexts/integration/domain/errors.ts`
- `src/contexts/integration/domain/types.ts`
- `src/contexts/integration/infrastructure/mappers/gbp-cache.mapper.test.ts`
- `src/contexts/integration/infrastructure/repositories/gbp-cache.repository.test.ts`
- `src/contexts/integration/server/shared.ts`
- `src/contexts/integration/CONTEXT.md`
- `src/composition.ts`
- `src/bootstrap.ts`
- `src/worker/index.ts`
- `src/routes/CONTEXT.md`
- `src/contexts/CONTEXT.md`
- `CONTEXT.md`
- `eslint.config.js`
- `drizzle.config.ts`
- `package.json`

### Cross-referenced files (for validation)
- `src/contexts/review/application/ports/google-review-api.port.ts`
- `src/contexts/review/domain/events.ts`
- `src/contexts/review/domain/types.ts`
- `src/contexts/review/build.ts`
- `src/contexts/review/infrastructure/jobs/purge-expired-reviews.job.ts`
- `src/contexts/review/infrastructure/jobs/refresh-expiring-reviews.job.ts`
- `src/contexts/integration/domain/events.ts`
- `src/shared/jobs/worker.ts`
- `src/shared/jobs/queue.ts`
- `src/shared/cache/redis.ts`
- `src/shared/domain/brand.ts`
- `src/shared/db/schema/review.schema.ts`
