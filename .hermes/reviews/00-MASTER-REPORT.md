# Master Review Report — Independent Re-Review (Round 2)

## Executive Summary

3 independent subagents reviewed 55+ files across the review bounded context, shared infrastructure, integration changes, and wiring. **1 broken test confirmed**, **1 architectural concern**, **1 runtime risk**, and **11 quality warnings** found.

| Split | Issues | P0 | P1 | P2 | P3 |
|-------|--------|----|----|----|----|
| Domain + Application | 17 | 0 | 4 | 8 | 5 |
| Infrastructure | 7 | 0 | 1 | 4 | 2 |
| Shared + Integration + Wiring | 4 | 0 | 1 | 2 | 1 |
| **Total** | **28** | **0** | **6** | **14** | **8** |

After deduplication and filtering noise: **4 issues worth fixing** (1 test bug, 2 P1s, 1 P2).

## Issues to Fix (Prioritized)

### P0 — Broken Test (MUST FIX)

**1. `constructors.test.ts:169` — Test expects wrong error code**
- File: `src/contexts/review/domain/constructors.test.ts`
- Test expects `'reply_not_found'` but `buildReply` returns `'invalid_reply'`
- **Test FAILS at runtime.** Confirmed: `npx vitest run` shows 1 failure
- Root cause: previous fix changed constructor error code but missed updating the test
- Fix: change line 169 from `'reply_not_found'` to `'invalid_reply'`

### P1 — Architectural: Domain Constructor Bypass

**2. `sync-reviews.ts:75-92` — Use case bypasses `buildReview` domain constructor**
- File: `src/contexts/review/application/use-cases/sync-reviews.ts`
- The sync use case manually assembles `Review` objects (line 75) instead of calling `buildReview()`
- This skips `isValidRating()` domain rule — a corrupt Google payload with `rating: 0` or `rating: 6` would be persisted
- `mirrorReply` (lines 153-174) similarly bypasses `buildReply()`, skipping empty-text validation
- **Assessment:** This may be intentional (trusted external data, already validated by adapter). If so, add a comment documenting the rationale. If not, route through constructors.
- **Verdict:** Flag but defer — document the intentional bypass with a comment

### P1 — Runtime: Queue Uses Shared Redis Connection

**3. `queue.ts:23` — BullMQ Queue uses shared Redis (`maxRetriesPerRequest: 3`)**
- File: `src/shared/jobs/queue.ts`
- `createJobQueue` uses `getRedis()` which has `maxRetriesPerRequest: 3`
- Worker correctly creates dedicated connection with `maxRetriesPerRequest: null`
- Under Redis instability, queue `.add()` may throw `MaxRetriesPerRequestError` → silent job loss
- Impact: webhook notifications and manual sync triggers
- Fix: create dedicated ioredis connection with `maxRetriesPerRequest: null` for Queue

### P2 — Missing Test Coverage

**4. No cross-org delete protection tests for `deleteById`**
- Files: `review.repository.test.ts`, `reply.repository.test.ts`
- Both `deleteById` tests only verify same-org deletion works
- No test verifies that `deleteById(reviewId, ORG_B)` for ORG_A's review is a safe no-op
- The WHERE clause includes `organizationId` so it's safe — but untested

## Confirmed Clean (Previous Fixes Verified)

All 18 fixes from the previous review round were verified present:
- ✅ `organizationId` added to `findByPropertyId`, `deleteById`, `deleteByPropertyId` (review)
- ✅ `organizationId` added to `deleteById` (reply)
- ✅ `'invalid_reply'` error code added to union (constructor fixed, **test missed**)
- ✅ `getLogger()` import + warning log in sync loop catch
- ✅ 429 → `gbp_api_rate_limited` mapping in adapter
- ✅ `.comment` field for GBP reviewReply
- ✅ `GoogleConnectionVisibilityChanged` re-exported
- ✅ `findAll*` prefix on system-level queries
- ✅ Tenant isolation TODO comment in `gbp-cache.schema.ts`
- ✅ 24h JWKS cache TTL
- ✅ `Response.json({ ok: true })` for webhook responses
- ✅ Single-queue decision documented in worker

## Additional Findings (Low Priority / Informational)

These were found but don't require immediate action:

- **P2:** Branded IDs in mappers (`review.mapper.ts`, `reply.mapper.ts`) not explicitly cast with `as string` — works at runtime but contradicts convention
- **P2:** `pubsub-jwt.verifier.test.ts` has no test for JWKS cache TTL invalidation
- **P2:** Missing `review.purged` event — purge job reuses `review.expired` (semantically ambiguous but functional)
- **P2:** Mapper round-trip test doesn't cover `null googleConnectionId` path
- **P3:** `reply.repository.test.ts` line 7: `../repositories/review.repository` should be `./review.repository`
- **P3:** Undocumented magic-number query limits (500, 5000) in repositories
- **P3:** `sentimentLabel` is `string | null` — could be a union type for type safety
- **P3:** `syncReviews` doesn't follow full 7-step use case pattern (no authorize step) — acceptable for system-level job, but worth a comment

## Test Results

- `tsc --noEmit`: ✅ Clean (0 errors)
- Domain + Application unit tests: ❌ **1 failure** (`constructors.test.ts > buildReply > returns Err for empty text`)
- Infrastructure integration tests: Not run (requires Postgres)

## Recommendations

1. **Fix the broken test immediately** — one-line change in `constructors.test.ts:169`
2. **Decide on constructor bypass** — either route through `buildReview`/`buildReply` or document the intentional choice
3. **Fix Queue Redis connection** — prevents silent job loss under Redis instability
4. **Add cross-org delete tests** — completes tenant isolation coverage

## Detailed Reports

- [01-review-domain-application.md](./01-review-domain-application.md)
- [02-review-infrastructure.md](./02-review-infrastructure.md)
- [03-shared-integration-wiring.md](./03-shared-integration-wiring.md)
