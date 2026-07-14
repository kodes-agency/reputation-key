# Phase 10 Audit Fixes — Implementation Plan

> **For Hermes:** Execute tasks sequentially. Run tests after each batch.

**Goal:** Fix all 14 audit findings from comprehensive Phase 10 code review.

**Architecture:** Patch existing files — no new files except tests for new behaviors.

---

## Batch 1: P0 + P1 Critical Fixes

### Task 1: Fix unique index — add `organizationId` (P0 #1)

**Files:**

- Modify: `src/shared/db/schema/review.schema.ts:56`
- Modify: `src/contexts/review/infrastructure/repositories/review.repository.ts:39`

**Step 1:** Change unique index to include `organizationId`:

```ts
// review.schema.ts:56 — BEFORE
uniqueIndex('reviews_platform_external_unique').on(t.platform, t.externalId),
// AFTER
uniqueIndex('reviews_platform_external_unique').on(t.platform, t.externalId, t.organizationId),
```

**Step 2:** Change `onConflictDoUpdate` target to include `reviews.organizationId`:

```ts
// review.repository.ts:39 — BEFORE
target: [reviews.platform, reviews.externalId],
// AFTER
target: [reviews.platform, reviews.externalId, reviews.organizationId],
```

**Verify:** `grep -n 'reviews_platform_external_unique' src/` shows orgId in both places.

### Task 2: Add `organizationId` to `findGoogleSyncByReviewId` (P1 #3)

**Files:**

- Modify: `src/contexts/review/application/ports/reply.repository.ts:9`
- Modify: `src/contexts/review/infrastructure/repositories/reply.repository.ts:29-42`
- Modify: `src/contexts/review/application/use-cases/sync-reviews.ts:127` (call site)
- Modify: `src/contexts/review/application/use-cases/sync-reviews.test.ts` (fake + assertions)

**Step 1:** Add `organizationId` param to port:

```ts
// reply.repository.ts (port) — BEFORE
findGoogleSyncByReviewId(reviewId: ReviewId): Promise<Reply | null>
// AFTER
findGoogleSyncByReviewId(reviewId: ReviewId, organizationId: OrganizationId): Promise<Reply | null>
```

**Step 2:** Add `eq(replies.organizationId, organizationId)` to SQL query in repo impl.

**Step 3:** Update call site in `sync-reviews.ts:127`:

```ts
// BEFORE
const existingGoogleReply = await deps.replyRepo.findGoogleSyncByReviewId(reviewId)
// AFTER
const existingGoogleReply = await deps.replyRepo.findGoogleSyncByReviewId(
  reviewId,
  organizationId,
)
```

**Step 4:** Update fake in test to accept and filter by `organizationId`.

**Verify:** `pnpm test src/contexts/review/` — all 27 tests pass.

### Task 3: Add per-review error recovery to sync loop (P1 #4)

**Files:**

- Modify: `src/contexts/review/application/use-cases/sync-reviews.ts:53-111`
- Modify: `src/contexts/review/application/use-cases/sync-reviews.test.ts`

**Step 1:** Import `getLogger` and wrap the for-loop body in try/catch:

```ts
import { getLogger } from '#/shared/observability/logger'

// Inside syncReviews, wrap loop body:
for (const gr of googleReviews) {
  try {
    // ... existing body (check existing, build review, upsert, mirror, emit)
  } catch (err) {
    getLogger().warn(
      { err, externalId: gr.externalId },
      'Failed to sync review, continuing',
    )
    continue
  }
}
```

**Step 2:** Update existing error-path tests. The `events.emit throws` and `reviewRepo.upsert throws` tests now expect:

- Sync does NOT throw (error caught per-review)
- Other reviews in batch still processed
- Sync result reflects partial success

**Step 3:** Add new test: "single review fails, others succeed" — verifies partial success result.

**Verify:** `pnpm test src/contexts/review/` — all tests pass with updated assertions.

### Task 4: Add `rating` CHECK constraint (P1 #5)

**Files:**

- Modify: `src/shared/db/schema/review.schema.ts:45`

Drizzle doesn't have a `check()` builder on columns, but you can use `.check()` on the table. Alternative: add a comment documenting the invariant. Since the adapter already validates, and Drizzle's `integer()` has no built-in range check, add a `$default` validation comment. Actual CHECK would require raw SQL migration — skip for now, document the gap.

**Decision:** Document as known gap with a code comment. The adapter's `STAR_RATING_MAP` is the enforcement layer.

---

## Batch 2: P2 Code Quality Fixes

### Task 5: Remove duplicate `StarRating` type in adapter (P2 #6)

**Files:**

- Modify: `src/contexts/integration/infrastructure/adapters/google-review-api.adapter.ts:20`

Remove local `type StarRating = 1 | 2 | 3 | 4 | 5` and import from domain:

```ts
import type { StarRating } from '#/contexts/review/domain/types'
```

### Task 6: Replace `console.warn` with `getLogger()` (P2 #7)

**Files:**

- Modify: `src/contexts/integration/infrastructure/adapters/google-review-api.adapter.ts:83`
- Modify: `src/contexts/integration/infrastructure/adapters/google-review-api.adapter.test.ts`

Import `getLogger` and use `logger.warn(...)` instead of `console.warn(...)`. Update test to mock `getLogger` instead of `console.warn`.

### Task 7: Add type assertion for `rating` in mapper (P2 #9)

**Files:**

- Modify: `src/contexts/review/infrastructure/mappers/review.mapper.ts:21`

```ts
// BEFORE
rating: row.rating,
// AFTER
rating: row.rating as Review['rating'],
```

This is a type-level assertion that the DB value matches the domain. The `as Review['rating']` resolves to `StarRating`. If `StarRating` changes, this will flag at compile time.

### Task 8: Add `platform` type assertion in mapper (P2 #8)

**Files:**

- Modify: `src/contexts/review/infrastructure/mappers/review.mapper.ts:15`

Already uses `row.platform as Review['platform']` — no change needed. Confirmed.

### Task 9: Document `findExpiringBefore`/`findExpiredBefore` semantics (P2 #12)

**Files:**

- Modify: `src/contexts/review/infrastructure/repositories/review.repository.ts:84-103`

Add JSDoc comments clarifying `lte` vs `lt` boundary behavior:

```ts
/** Reviews where expiresAt <= date (inclusive). Used by refresh job to find reviews nearing expiry. */
findExpiringBefore: ...

/** Reviews where expiresAt < date (exclusive). Used by purge job — excludes reviews expiring exactly at threshold. */
findExpiredBefore: ...
```

Also document that these are system-level queries (no tenant filter by design).

---

## Batch 3: P3 Low-priority + Docs

### Task 10: Create `CONTEXT.md` for review context (P3 #13)

**Files:**

- Create: `src/contexts/review/CONTEXT.md`

Minimal glossary per project conventions (see root `CONTEXT.md` format).

### Task 11: Add UUID validation on job data rehydration (P3 #11)

**Files:**

- Modify: `src/contexts/review/infrastructure/jobs/sync-property-reviews.job.ts`

Add a simple UUID regex check at the top of the handler for `job.data` fields. If invalid, log and return (don't crash the worker).

### Task 12: Add clarifying comments on branded ID casts in refresh job (P3 #10)

**Files:**

- Modify: `src/contexts/review/infrastructure/jobs/refresh-expiring-reviews.job.ts:31-34`

Add comment explaining the `as string` casts are for serializable job data, and the consumer re-brands them.

---

## Verification

After all tasks:

1. `pnpm test` — full suite passes (1003+ tests)
2. `grep -rn 'console.warn\|console.log\|console.error' src/contexts/review/ src/contexts/integration/infrastructure/adapters/google-review-api.adapter.ts` — zero results
3. Manual grep: unique index includes `organizationId`
4. Manual grep: `findGoogleSyncByReviewId` signature includes `organizationId`
