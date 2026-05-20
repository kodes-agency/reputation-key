# Review #1 — Phase 10-11 (Review + Inbox Contexts)

**Reviewer**: Senior Code Reviewer (Grumpy)
**Date**: 2026-05-20
**Scope**: `src/contexts/review/`, `src/contexts/inbox/`, `src/components/inbox/`, `src/shared/db/schema/review.schema.ts`, `src/shared/db/schema/inbox.schema.ts`

---

## Executive Summary

| Severity | Count |
| -------- | ----- |
| Critical | 2     |
| Major    | 6     |
| Minor    | 5     |
| Nit      | 3     |

**Verdict: FAIL** — Critical semantic bugs in sync error handling and unread count logic must be fixed before merge.

---

## Critical Issues

### C1: sync-reviews returns error on partial success — data already persisted

- **File**: `src/contexts/review/application/use-cases/sync-reviews.ts`
- **Lines**: 167-175
- **What**: When `failed > 0`, the function returns `err(reviewError('sync_failed', ...))`. But ALL successfully processed reviews were already upserted to the DB and events already emitted. The caller gets an `Err` and may retry, causing duplicate syncs for the successful reviews.
- **Why**: Semantic bug — partial sync is actually a success with warnings, not a failure. The `err()` return causes the BullMQ job handler in `sync-property-reviews.job.ts` to log a warning and NOT retry (line 68-70), which is correct behavior. But the type signature lies — callers can't distinguish "partial success" from "total failure".
- **Fix**: Return `ok(result)` always when data was persisted. Add `hasWarnings` or `partialFailure` field to `SyncReviewsResult`. Only return `err()` for pre-processing failures (API fetch failure).

### C2: get-unread-count fallback counts ALL org items, not per-user

- **File**: `src/contexts/inbox/application/use-cases/get-unread-count.ts`
- **Lines**: 36
- **What**: `deps.repo.countByStatus(input.organizationId, 'new')` counts all `new` inbox items for the entire organization. The unread counter is per `(orgId, userId)`. In a multi-user org, User A sees a count that includes items User B hasn't read either.
- **Why**: The "unread" concept is org-level (all items with status `new`), not per-user. But the Redis counter key is `inbox:unread:${orgId}:${userId}`, implying per-user. This is architecturally confused. Either unread is org-level (all users share the same count) or per-user (each user has their own read state).
- **Fix**: If unread is org-level: remove userId from the counter key, remove userId param. If per-user: need per-user `readAt` tracking per inbox item (which doesn't exist). Current implementation is a mix that produces wrong counts.

---

## Major Issues

### M1: Variable shadowing in sync-reviews catch block

- **File**: `src/contexts/review/application/use-cases/sync-reviews.ts`
- **Lines**: 149
- **What**: `catch (err)` shadows the imported `err` function from `neverthrow` (line 32). While JS scoping rules make this work, it's confusing and error-prone. If someone later adds `err()` calls inside the catch block, they'll get the caught exception, not the neverthrow function.
- **Fix**: Rename to `catch (e)` or `catch (syncErr)`.

### M2: `updatedAt: new Date()` hardcoded in repositories — not testable

- **Files**:
  - `src/contexts/review/infrastructure/repositories/review.repository.ts` (line 58)
  - `src/contexts/review/infrastructure/repositories/reply.repository.ts` (line 59)
  - `src/contexts/inbox/infrastructure/repositories/inbox.repository.ts` (lines 143, 167, 192, 222)
- **What**: Repository `upsert`/`update` methods use `new Date()` directly instead of the injected `clock()` from use case deps. This breaks time-determinism in tests.
- **Why**: The use cases inject `clock()` for testability, but repositories bypass it with `new Date()`. Integration tests can't verify exact timestamps.
- **Fix**: Pass clock to repository factory, or accept `now` param in mutation methods.

### M3: Hardcoded non-existent platforms in inbox-filters

- **File**: `src/components/inbox/inbox-filters.tsx`
- **Lines**: 44-49
- **What**: `platforms` array includes `'booking'`, `'tripadvisor'`, `'airbnb'`. The schema only defines `reviewPlatformEnum = pgEnum('review_platform', ['google'])`. These options will render in the filter UI but can never match any data. Users will think the filter is broken.
- **Fix**: Remove non-existent platforms or source the list from the schema/domain types.

### M4: N+1 query pattern in bulk-update-inbox-status

- **File**: `src/contexts/inbox/application/use-cases/bulk-update-inbox-status.ts`
- **Lines**: 48-82
- **What**: For each of up to 100 inbox item IDs, the use case calls `findById` individually. This produces up to 100 sequential DB queries.
- **Why**: Performance problem at scale. A single `WHERE id IN (...)` query would be 100x more efficient.
- **Fix**: Add `findByIds(ids, orgId)` to the repository port, batch-fetch all items in one query.

### M5: `replies` unique constraint blocks Phase 12 multi-draft workflow

- **File**: `src/shared/db/schema/review.schema.ts`
- **Lines**: 80
- **What**: `uniqueIndex('replies_review_source_unique').on(t.reviewId, t.source, t.organizationId)` allows only ONE reply per `(reviewId, source, organizationId)`. Phase 12 plans to add `source = 'internal'` with draft/approve/reject workflow, which requires multiple internal replies (drafts).
- **Why**: The unique constraint will prevent creating a second internal draft after the first. Phase 12 will need a migration to drop/modify this index.
- **Fix**: Either document this as a known Phase 12 migration item, or change the constraint now to `(reviewId, source, organizationId, status)` to allow multiple internal replies with different statuses.

### M6: Property-scoped access check called N times in bulk update

- **File**: `src/contexts/inbox/application/use-cases/bulk-update-inbox-status.ts`
- **Lines**: 53-75
- **What**: Inside the per-item loop, for non-admin users, `getAccessiblePropertyIds()` is called on every iteration. This is the same call returning the same result N times.
- **Why**: Wasteful. Should call once before the loop and cache the result.
- **Fix**: Hoist the access check outside the loop.

---

## Minor Issues

### m1: Inconsistent branded ID handling across event handlers

- **File**: `src/contexts/inbox/infrastructure/event-handlers/on-review-updated.ts`
- **Lines**: 17
- **What**: Uses `unbrand(event.reviewId)` to convert, while `on-review-created.ts` passes branded ID directly as `sourceId`. Both work at runtime but the inconsistency suggests no agreed pattern.
- **Fix**: Pick one approach and use it everywhere.

### m2: Rating cast without runtime validation in mapper

- **File**: `src/contexts/review/infrastructure/mappers/review.mapper.ts`
- **Lines**: 21
- **What**: `row.rating as Review['rating']` — if DB data is corrupted (e.g. rating=6), the domain object silently carries invalid data.
- **Fix**: Add a runtime assertion or `isValidRating` check in the mapper.

### m3: InboxNotesThread shows raw UUID prefix instead of user name

- **File**: `src/components/inbox/inbox-notes-thread.tsx`
- **Lines**: 79
- **What**: `note.authorUserId.slice(0, 8)…` shows "a1b2c3d4…" to the user. This is terrible UX.
- **Fix**: Resolve user name via a server function or pass author name from the use case.

### m4: Redis Lua script re-evaluated on every decrement

- **File**: `src/contexts/inbox/infrastructure/adapters/redis-unread-counter.ts`
- **Lines**: 27-34
- **What**: The Lua script string is passed to `redis.eval()` on every call. Redis parses the script each time.
- **Fix**: Use `redis.evalsha()` with script pre-loading, or define script as a constant and use `redis.defineCommand()`.

### m5: sync-reviews `SyncReviewsResult` passed as error context with wrong type

- **File**: `src/contexts/review/application/use-cases/sync-reviews.ts`
- **Lines**: 172
- **What**: `reviewError('sync_failed', '...', result)` — the `result` (SyncReviewsResult) is passed as the `context` parameter, which is typed as `Record<string, unknown>`. `SyncReviewsResult` is not a Record, it's a plain object. TypeScript allows this structural match, but it's semantically wrong.
- **Fix**: Wrap in `{ result }` or `{ stats: result }`.

---

## Nit Issues

### n1: `loadCount` callback has empty dependency array but captures `loadAction`

- **File**: `src/components/inbox/inbox-unread-badge.tsx`
- **Lines**: 13-23
- **What**: `useCallback(async () => { ... loadAction ... }, [])` — `loadAction` is not in deps. Works because ref pattern is used, but the empty deps is misleading.
- **Fix**: Not a bug (ref pattern is used), but add a comment.

### n2: `catch` blocks silently swallow errors in inbox repository

- **File**: `src/contexts/inbox/application/use-cases/update-inbox-status.ts`
- **Lines**: 87-91
- **What**: `catch {}` with comment "Counter unavailable — non-critical". Multiple instances across use cases. Acceptable but worth noting.
- **Fix**: Add structured logging in the catch blocks.

### n3: `loadDetail` dependency array uses optional chain

- **File**: `src/components/inbox/use-inbox-detail.ts`
- **Lines**: 73, 85
- **What**: `[item?.id]` in useCallback deps. Works but unconventional.
- **Fix**: Use `item?.id ?? null` or just `item?.id` (it's fine, just looks odd).

---

## Positive Notes

- Domain layer is clean: tagged errors, branded IDs, Readonly<> everywhere, proper Result types
- Status transition graph is well-tested with exhaustive coverage
- Event handlers properly handle duplicate detection (`already_exists`)
- Repository factory pattern is consistent
- Cursor-based pagination is implemented correctly
- Role-scoped property access is enforced in every use case
- Zod schemas validate all server function inputs
- Error → HTTP status mapping uses exhaustive `ts-pattern` match
- Domain constructors have comprehensive test coverage including exhaustive error code tracking
