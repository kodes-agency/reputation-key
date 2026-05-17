# Round 2 Review Fix Plan

Independent re-review found 12 issues. Grouped into 3 phases by priority and file proximity.

## Phase 1 — P0 Broken Test + P1 Constructor Bypass Documentation

### Task 1: Fix broken test assertion
- **File:** `src/contexts/review/domain/constructors.test.ts` (line 169)
- **Change:** `'reply_not_found'` → `'invalid_reply'`
- **Verify:** `npx vitest run src/contexts/review/domain/constructors.test.ts`

### Task 2: Document intentional constructor bypass in sync use case
- **File:** `src/contexts/review/application/use-cases/sync-reviews.ts`
- **Change:** Add JSDoc comment above the review assembly block (lines 74-92) explaining why `buildReview()` is intentionally bypassed (trusted external data, already validated by adapter layer). Same for `mirrorReply` (lines 141-185).
- Also add comment explaining the use case doesn't follow the full 7-step pattern (system-level job, no authorization step needed).

### Task 3: Add missing exhaustive error code test
- **File:** `src/contexts/review/domain/constructors.test.ts`
- **Change:** Add test verifying all codes in `ReviewErrorCode` union are accounted for, with `toHaveLength(N)` guard.
- Need to first check `errors.ts` to count exact number of codes.

## Phase 2 — P1 Queue Redis + P2 Mapper Casts + P2 Tests

### Task 4: Fix BullMQ Queue Redis connection
- **File:** `src/shared/jobs/queue.ts`
- **Change:** Create dedicated ioredis connection with `maxRetriesPerRequest: null` instead of using shared `getRedis()`.
- Must import ioredis directly and construct connection from `REDIS_URL` env (same as worker does).
- Verify: `tsc --noEmit`

### Task 5: Add `as string` casts to mapper branded IDs
- **Files:**
  - `src/contexts/review/infrastructure/mappers/review.mapper.ts` (toRow function)
  - `src/contexts/review/infrastructure/mappers/reply.mapper.ts` (toRow function)
- **Change:** Add `as string` to all branded ID fields in toRow functions.

### Task 6: Add cross-org delete protection tests
- **Files:**
  - `src/contexts/review/infrastructure/repositories/review.repository.test.ts`
  - `src/contexts/review/infrastructure/repositories/reply.repository.test.ts`
- **Change:** Add `deleteById` test that verifies deleting with wrong orgId is a no-op.

### Task 7: Fix misleading import path
- **File:** `src/contexts/review/infrastructure/repositories/reply.repository.test.ts` (line 7)
- **Change:** `'../repositories/review.repository'` → `'./review.repository'`

### Task 8: Add null googleConnectionId mapper round-trip test
- **File:** `src/contexts/review/infrastructure/mappers/review.mapper.test.ts`
- **Change:** Add round-trip test variant with `googleConnectionId: null`.

### Task 9: Add JWKS cache TTL invalidation test
- **File:** `src/shared/auth/pubsub-jwt.verifier.test.ts`
- **Change:** Add test using `vi.useFakeTimers()` + `vi.resetModules()` to verify JWKS cache invalidates after 24h.

## Phase 3 — P3 Low Priority

### Task 10: Document query limit magic numbers
- **Files:**
  - `src/contexts/review/infrastructure/repositories/review.repository.ts`
  - `src/contexts/review/infrastructure/repositories/reply.repository.ts`
- **Change:** Extract limits to named constants with explanatory comments. Add limit to `findByReviewId` (reply repo).

### Task 11: Document `review.purged` event decision
- **File:** `src/contexts/review/domain/events.ts`
- **Change:** Add comment explaining why purge job reuses `review.expired` instead of having a separate `review.purged` event.

### Task 12: Narrow `sentimentLabel` type
- **File:** `src/contexts/review/domain/types.ts`
- **Change:** `sentimentLabel: string | null` → `sentimentLabel: 'positive' | 'negative' | 'neutral' | 'mixed' | null`
- May need to update constructor, mapper, and tests if they rely on arbitrary strings.

## Final Verification
- `tsc --noEmit` — zero errors
- `npx vitest run src/contexts/review/domain/ src/contexts/review/application/` — all green
