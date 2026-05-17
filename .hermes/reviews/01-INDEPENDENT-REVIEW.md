# Independent Review — Review Bounded Context (Phase 10)

**Reviewer mood:** Pissed off. Hates slop, dead code, and overcomplication.
**Date:** 2025-06-01
**Scope:** All uncommitted changes on `kodes-agency/fallow-setup` branch, `guangzhou` worktree

---

## Summary Verdict: **Surprisingly solid. Annoyingly few things to complain about.**

The review context is clean, well-structured, and follows the project's DDD architecture conventions. Domain types are `Readonly<>`, errors are tagged, events are past-tense, mappers are pure functions, repos use `organizationId` on every query, and the composition root is the only place where wires cross.

That said — here's everything I *can* complain about.

---

## Issues Found

### 1. **`SentimentLabel` is `string | null` — not a union** (LOW — already documented)

`types.ts:19-22` — `SentimentLabel` is `string | null` with a comment saying "narrow to a union once the sentiment provider is stabilized." This is a deliberate design choice but it means no compile-time guarantee that sentiment labels are valid. A typo like `'positve'` would silently pass through.

**Verdict:** Acceptable with the comment. Fix when the sentiment provider lands.

---

### 2. **`ok` variable shadowing in sync-property-reviews.job.ts** (LOW)

`sync-property-reviews.job.ts:64` — `const ok = result.value` shadows the `ok` function from `neverthrow`. It works because `ok` from neverthrow is only used in the import (not in this file — this file doesn't import `ok` from neverthrow). But it's a confusing variable name that could trip someone up.

**Verdict:** Rename to `syncResult` or `stats`. Trivial.

---

### 3. **Webhook imports `getContainer()` AND `getDb()` directly** (MEDIUM — documented exception)

`notifications.ts:8-9` imports both `getContainer()` and `getDb()`. Per architecture, API routes should NOT import `getContainer()` or Drizzle schema directly. This webhook does both:
- `getDb()` to query `properties` table directly (line 70)
- `getContainer()` to access the job queue (line 93)

The comment at the top says "No auth guard — JWT verification is manual" and the route is in `integration/` context's webhook. This is a documented exception pattern in the project.

**Verdict:** Acceptable for webhooks (no user session, no auth guard). The alternative — adding a PropertyRepository port method like `findByGbpPlaceId` — would be cleaner but is overkill for a single query.

---

### 4. **Google Review API adapter: heavy `as Record<string, unknown>` casting** (MEDIUM)

`google-review-api.adapter.ts:82-103` — The GBP API response parsing is a wall of `as Record<string, unknown>` casts. This is because the GBP API returns untyped JSON. The current approach works but is brittle:

```ts
reviewerName: (raw.reviewer as Record<string, unknown> | undefined)?.displayName as string | null ?? null,
```

If Google changes the `reviewer` shape, this silently returns `null` instead of failing.

**Better approach:** Zod schema for the GBP API response. Parse once, validate once, then use typed data throughout.

**Verdict:** Works today. Should be a Zod schema when this adapter graduates from MVP status.

---

### 5. **`reviewFromRow` casts `row.rating as Review['rating']` without validation** (LOW)

`review.mapper.ts:22` — `rating: row.rating as Review['rating']`. If the DB somehow has a rating of 0 or 6, this cast silently passes it through. The domain's `isValidRating` guard is bypassed because mappers operate at the infrastructure layer.

**Verdict:** Low risk — the DB enum constrains to integer, and only `buildReview` (with validation) or the sync use case (with adapter-validated data) writes to the DB. Not worth adding validation to mappers.

---

### 6. **`replyToRow` doesn't set `createdAt`/`updatedAt`** — relies on DB default (OK by design)

`reply.mapper.ts:24-31` — `replyToRow` returns an `Omit<Reply, 'createdAt' | 'updatedAt'>` which maps to `ReplyInsertRow`. The DB columns have `defaultNow()`, so inserts work. On upsert (ON CONFLICT), `createdAt` and `updatedAt` are NOT in the `set` clause, meaning `updatedAt` never changes on reply upsert.

**Wait.** The `reviewToRow` also doesn't include `createdAt`/`updatedAt`, and the review upsert's `set` clause also doesn't update `updatedAt`. This means **reviews and replies never track when they were last updated**.

`review.repository.ts:33-43` — the upsert `set` clause updates 11 fields but NOT `updatedAt`. Every upserted review will have `updatedAt` equal to `createdAt` forever.

**This is a bug.** The `updatedAt` column should be updated on every upsert. The `set` clause needs `updatedAt: new Date()`.

**Severity:** MEDIUM. Data integrity issue — `updatedAt` is meaningless if it never changes.

---

### 7. **`findAllExpiringBefore` and `findAllExpiredBefore` have no tenant filter** (OK by design — documented)

`review.repository.ts` — Both system-level queries scan ALL organizations. The comments explicitly state "System-level query — no tenant filter by design." This is correct for cron jobs that need to process all orgs.

**Verdict:** Fine. The 5000-row limit is a safety valve.

---

### 8. **Purge job emits `review.expired` event — but the review was already marked as expired** (LOW)

`purge-expired-reviews.job.ts` — The comment says "Emit event BEFORE delete so downstream handlers can still access review data." This makes sense. But the event is `review.expired`, which semantically means "the review has expired" — not "the review is about to be hard-deleted after the grace period."

If a downstream handler reacts to `review.expired` by sending an email notification, the user would get a second "your review expired" email when the purge job runs (the first was emitted when the review originally expired).

**Verdict:** Low. No downstream handlers today. When one is added, the event semantics should be reconsidered — possibly a separate `review.purged` event type.

---

### 9. **Integration test fragility — shared Neon DB** (MEDIUM)

Both integration test files (`review.repository.test.ts`, `reply.repository.test.ts`) run against a real Neon PostgreSQL instance. Tests use `beforeEach` to truncate tables. This means:
- Tests can't run offline
- Tests are slow (network round trips)
- Tests are fragile (Neon pooler replication lag caused the PK conflict bug we just fixed)
- Tests can't run in CI without a Neon DB connection

**Verdict:** Acceptable for a pre-production project. Consider adding a Docker PostgreSQL container for CI.

---

### 10. **`syncReviews` returns `Err` when `failed > 0` but still persisted data** (DESIGN)

`sync-reviews.ts:72-74` — If some reviews fail but others succeed, the function returns `Err(sync_failed)` with the result stats in `context`. The data IS persisted (upserted reviews are in the DB), but the caller gets an error.

The job handler (`sync-property-reviews.job.ts:60-66`) handles this correctly — it logs a warning and doesn't throw, so BullMQ won't retry.

**Verdict:** This is a partial success pattern. It works. But `Err` usually means "nothing happened." A `Result<{stats}, {error, partialResult}>` or a dedicated `PartialFailure` type would be more honest.

---

## Things I Expected to Complain About But Can't

- **Dead code:** None found. Every export is used or has a `fallow-ignore-next-line unused-type` annotation for future-proofing.
- **`any` types:** Zero. Not a single `any` in production code.
- **`console.log`:** None. All logging through `getLogger()`.
- **Architecture violations:** Webhook is the only exception (documented). Everything else follows the port/adapter pattern.
- **Missing tenant isolation:** Every repo method includes `organizationId`. System-level queries are documented as intentional.
- **BullMQ config:** Dedicated Redis connections with `maxRetriesPerRequest: null`. No shared connection bug.
- **Branded IDs:** Consistently used everywhere, `as string` only in mappers and job data (documented as intentional for serialization).
- **Test quality:** 2,207 lines of tests. In-memory fakes for unit tests, real DB for integration tests. Tests assert on state, not mock call counts. Error resilience tested. Emit-before-delete ordering verified.

---

## Action Items

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| 1 | **MEDIUM** | `updatedAt` never updated on upsert | Add `updatedAt: new Date()` to both upsert `set` clauses |
| 2 | LOW | `ok` variable shadowing in job handler | Rename to `stats` |
| 3 | LOW | GBP adapter lacks Zod schema for API response | Add when adapter graduates MVP |
| 4 | LOW | `review.expired` event reused for purge | Consider `review.purged` when handlers exist |

---

## Lines of Code

- Production: ~1,200 lines across 20 files
- Tests: ~2,200 lines across 9 test files
- Ratio: **1.8:1 test-to-code** — healthy

## Architecture Score: **8/10**

Clean DDD separation, proper port/adapter pattern, tagged errors, branded IDs, readonly types, pure mappers, event-driven. Deductions for the `updatedAt` bug (#1) and the GBP adapter's lack of response validation (#4).
