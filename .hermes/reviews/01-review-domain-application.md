# Review: Review Context — Domain + Application

## Summary

17 issues found: 4 critical (P0/P1), 13 warnings (P2/P3). The domain layer (types, errors, rules, constructors, events) is well-structured. The main concerns are in the application layer: the sync use case bypasses domain constructors (skipping validation), a test asserts the wrong error code, and the composition root uses a non-null assertion. Tenant isolation is correctly enforced throughout.

## Critical Issues (P0/P1)

- **File:** `src/contexts/review/application/use-cases/sync-reviews.ts` (lines 75–92) — **Bypasses `buildReview` domain constructor.** The use case manually assembles the `Review` object instead of using `buildReview()`. This skips the `isValidRating` domain rule entirely — if the Google API ever returns a rating outside 1–5 (e.g., 0 from a corrupt payload), the invalid value would be persisted to the database. The convention explicitly states constructors compose rules and return `Result<T,E>`. Fix: call `buildReview()`, check the Result, and throw a tagged error on `Err`.

- **File:** `src/contexts/review/application/use-cases/sync-reviews.ts` (lines 153–174, `mirrorReply`) — **Bypasses `buildReply` domain constructor.** The `mirrorReply` helper manually constructs `Reply` objects for upsert without calling `buildReply()`. This skips the empty-text validation rule. While Google replies are unlikely to be empty, this violates the architectural invariant that all entity creation goes through constructors.

- **File:** `src/contexts/review/domain/constructors.test.ts` (line 169) — **Wrong expected error code.** The test asserts `result.error.code` is `'reply_not_found'`, but `buildReply` returns `reviewError('invalid_reply', ...)` on line 70 of `constructors.ts`. The error code `'reply_not_found'` semantically means "reply lookup failed", not "reply text is empty". The correct expected code is `'invalid_reply'`. This test will fail at runtime.

- **File:** `src/contexts/review/application/use-cases/sync-reviews.ts` (line 11) — **Application layer imports `getLogger` from `#/shared/observability/logger`.** While `shared/` imports are technically allowed, the convention says "application/ imports from domain/ and shared/ only — never infrastructure, server, routes, components." The observability module is shared infrastructure, not domain. The logging on line 122 (`getLogger().warn(...)`) means the use case has a hard dependency on the logging module. Consider injecting a logger into deps or accepting it as a trade-off with a comment.

## Warnings (P2/P3)

- **File:** `src/contexts/review/build.ts` (line 40) — **Non-null assertion `input.jobQueue!`** inside the conditional branch that already checks `input.jobQueue` is truthy. TypeScript narrows this correctly after the ternary, but the `!` on line 40 is redundant and violates the "no non-null assertions" convention. Fix: assign to a local `const queue = input.jobQueue` inside the branch.

- **File:** `src/contexts/review/application/use-cases/sync-reviews.ts` — **Does not follow 7-step use case pattern.** The convention specifies: authorize → validate refs → uniqueness → build → persist → emit → return. This use case skips authorization (reasonable for a system-level job) and reference validation (no property/connection existence check). Adding a comment explaining why these steps are omitted would improve clarity.

- **File:** `src/contexts/review/domain/constructors.test.ts` — **Missing exhaustive error code test.** Convention requires "exhaustive test of all codes in union + toHaveLength(N) guard." There is no test verifying that all 10 codes in `ReviewErrorCode` are covered. Add a test like:
  ```ts
  const codes: ReviewErrorCode[] = ['unauthorized', 'property_not_found', ...]
  expect(codes).toHaveLength(10)
  ```

- **File:** `src/contexts/review/domain/rules.ts` — **`isValidRating` does not guard against `NaN`.** `isValidRating(NaN)` returns `false` (because `Set.has(NaN)` returns `false`), which is correct, but there is no explicit test for `NaN`, `Infinity`, or non-integer values like `3.5`. While `3.5` is tested, `NaN` and `Infinity` are not.

- **File:** `src/contexts/review/domain/rules.ts` — **`calculateExpiresAt` returns `now` for expired reviews, not `reviewedAt`.** When `remainingRetention <= 0`, it returns `now`, meaning the review expires "immediately." This creates a moving target — the same expired review would get a different `expiresAt` on each sync. This may be intentional (re-sync refreshes expiry) but should be documented.

- **File:** `src/contexts/review/application/use-cases/sync-reviews.test.ts` (line 221) — **Non-null assertion `env.reviewStore.get(...)!`** on lines 221, 295, 344, 356, 538, 550, 566, 579. Tests use `!` to assert non-null. While common in tests, the convention states "no non-null assertions." Consider using `expect(stored).toBeDefined()` before accessing, or wrapping in `if (!stored) throw new Error(...)`.

- **File:** `src/contexts/review/application/use-cases/sync-reviews.test.ts` (line 433) — **Type cast `Review & { createdAt?: Date; updatedAt?: Date }`** in the mock implementation. This is a minor type-safety concern but acceptable for test mocks.

- **File:** `src/contexts/review/application/ports/review.repository.ts` (line 9) — **`upsert` takes `Omit<Review, 'createdAt' | 'updatedAt'>`** without a separate `organizationId` parameter. The organizationId is embedded in the review object, so the implementation MUST use `review.organizationId` in the WHERE clause. This is implicit and should be documented on the port with a JSDoc comment to prevent an implementor from forgetting the tenant filter.

- **File:** `src/contexts/review/application/ports/review.repository.ts` (line 12) — **`findAllExpiringBefore` and `findAllExpiredBefore`** are system-level queries (no org filter), correctly named with `findAll*` prefix. However, `findByOrganizationId` (line 11) is not named `findAll*` but takes an org ID — this is correct since it filters by org. No issue here, just confirming tenant isolation is correct.

- **File:** `src/contexts/review/domain/errors.ts` — **`ReviewErrorCode` includes `'reply_not_found'` and `'reply_already_exists'`** which are reply-specific. Consider whether these belong in a separate `ReplyErrorCode` type or if this single error type is intentionally covering all review-context errors. If the latter, document it.

- **File:** `src/contexts/review/domain/types.ts` (line 33) — **`sentimentLabel: string | null`** is unvalidated. Any string is accepted. Consider making this a union type (e.g., `'positive' | 'negative' | 'neutral' | 'mixed' | null`) to prevent arbitrary values.

- **File:** `src/contexts/review/application/use-cases/sync-reviews.ts` (lines 136–138) — **Partial failure returns `Err` with stats in context.** When some reviews fail, the entire result is `Err` but the stats are embedded in `context`. This means the caller can't easily distinguish "total failure" (API down) from "partial failure" (2 of 10 failed). Consider a separate error code like `'sync_partial_failure'` or returning `Ok` with failure details in the result.

## Positive Findings

- **Tenant isolation is thorough.** Every repository method that queries by ID includes `organizationId`. The `findByExternalId` composite key `${orgId}:${externalId}` pattern in tests demonstrates correct multi-tenant awareness.

- **Domain types are properly `Readonly<>`-wrapped.** All entity types (`Review`, `Reply`, `GoogleReview`) and their fields use `Readonly<>`. Arrays use `ReadonlyArray<T>`.

- **Events follow past-tense naming.** `review.created`, `review.updated`, `review.expired` — all correct. Events carry domain types (`StarRating`, not `number`).

- **Error pattern is consistent.** Tagged errors with `_tag: 'ReviewError'`, closed union of codes, `createErrorFactory` smart constructor.

- **Domain rules are pure functions.** `isValidRating` and `calculateExpiresAt` have no side effects, no async, no throw.

- **Test coverage is comprehensive.** Tests cover: fresh sync, re-sync, mixed new/existing, reply mirroring (4 states), expiresAt calculation, empty response, error propagation (API failure, emit failure, upsert failure), tenant isolation, event payloads, sentiment preservation, ID handling.

- **Branded IDs are used correctly.** Test fixtures use `reviewId(...)`, `replyId(...)` constructors — no `as any` casts.

- **Composition root (`build.ts`) is clean.** Properly wires infrastructure adapters to application ports, injects `clock` and `idGen` for testability.

- **Queue port correctly uses plain `string` types** for BullMQ serialization, with documented justification.

## Files Reviewed

1. `src/contexts/review/domain/types.ts`
2. `src/contexts/review/domain/errors.ts`
3. `src/contexts/review/domain/rules.ts`
4. `src/contexts/review/domain/rules.test.ts`
5. `src/contexts/review/domain/constructors.ts`
6. `src/contexts/review/domain/constructors.test.ts`
7. `src/contexts/review/domain/events.ts`
8. `src/contexts/review/application/ports/review.repository.ts`
9. `src/contexts/review/application/ports/reply.repository.ts`
10. `src/contexts/review/application/ports/review-queue.port.ts`
11. `src/contexts/review/application/ports/google-review-api.port.ts`
12. `src/contexts/review/application/dto/sync-reviews.dto.ts`
13. `src/contexts/review/application/use-cases/sync-reviews.ts`
14. `src/contexts/review/application/use-cases/sync-reviews.test.ts`
15. `src/contexts/review/build.ts`
16. `src/contexts/review/CONTEXT.md`
17. `src/shared/domain/errors.ts` (supporting)
18. `src/shared/domain/ids.ts` (supporting)
19. `src/shared/events/event-bus.ts` (supporting)
20. `src/shared/events/events.ts` (supporting)
