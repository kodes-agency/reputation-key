# Phase 11 Inbox Review — Iteration 1

Date: 2025-07-09
Reviewer: Senior Code Review Agent (automated)
Base commit: 38f7b2e (pre-inbox)
Files reviewed: 42

## Summary

The inbox bounded context follows hexagonal architecture correctly and demonstrates solid domain modeling — pure types, branded IDs, tagged errors, neverthrow Results in the domain layer. Status transitions are well-defined with a clean state machine. The test suite covers domain rules, constructors, use cases, mappers, and repositories with 105 passing tests.

However, the implementation has two critical flaws that were fixed in this iteration. First, server functions trusted `organizationId` from client payloads instead of resolving it from the authenticated session via `resolveTenantContext`. This is a tenant isolation vulnerability — any authenticated user could access other tenants' inbox data by sending a different `organizationId`. Second, `getInboxItemDetail` accessed the repository directly from the server layer, bypassing the use case abstraction that every other server function follows.

## Critical Issues (must fix)

| # | File | Issue | Severity |
|---|------|-------|----------|
| C1 | `server/inbox.ts` | All 7 server functions trusted client-sent `organizationId`/`userId` instead of resolving from authenticated session. Tenant isolation broken. | CRITICAL |
| C2 | `server/inbox.ts` | `getInboxItemDetail` accessed `inboxRepo` directly instead of going through a use case. Architectural violation — server layer bypassing application layer. | CRITICAL |

## Medium Issues (should fix)

| # | File | Issue | Severity |
|---|------|-------|----------|
| M1 | `use-cases/get-unread-count.test.ts` | 9 instances of `any` type in test mocks. Should use typed mock factories. | MEDIUM |
| M2 | `components/inbox/inbox-detail-sheet.tsx` | 302 lines exceeds 150-line max-lines ESLint rule. Should be split into sub-components. | MEDIUM |
| M3 | `repositories/inbox.repository.ts` | `findDetailById` returns `InboxItemDetail` which includes source data. Mapper assumes specific source schemas — fragile if review/feedback shapes change. | MEDIUM |
| M4 | `event-handlers/on-review-created.ts` | `sourceId as string` cast without validation. If event payload changes, this silently corrupts data. | MEDIUM |

## Minor Issues (nice to fix)

| # | File | Issue | Severity |
|---|------|-------|----------|
| m1 | `server/inbox.ts` (original) | No `.inputValidator()` on any server function — inconsistent with portal context which uses them. **Note: Fixed in rewrite — all 7 now use `.inputValidator()`.** | MINOR |
| m2 | `components/inbox/inbox-list.tsx` | Missing error state handling when `useMatch` returns no route. Edge case. | MINOR |
| m3 | `infrastructure/adapters/redis-unread-counter.ts` | `decrement` uses raw `DECR` which can go negative. Should use `DECRBY` with floor of 0. | MINOR |
| m4 | `application/dto/inbox.dto.ts` | `bulkUpdateStatusDto` allows empty `inboxItemIds` array. Should have `.min(1)` constraint. | MINOR |

## Fixes Applied

1. **C1 FIXED**: Rewrote `server/inbox.ts` — all 7 functions now call `headersFromContext()` + `resolveTenantContext(headers)` to get `organizationId`/`userId` from authenticated session, matching portal/identity/integration context patterns.
2. **C2 FIXED**: Created `get-inbox-item-detail.ts` use case in application layer. Wired in `build.ts`. Server function now delegates to use case.
3. Fixed unsafe `inboxItemId()` cast used for `userId` → proper `userId()` brand.
4. Fixed unused `data` param in `getUnreadCountFn` → `_data`.

## Positive Notes

- Domain layer is exemplary: pure types, no I/O, no async, branded IDs everywhere, clean error types with `_tag`.
- Status state machine is well-designed with proper transition validation and comprehensive tests.
- Event handlers use `onConflictDoUpdate` for idempotency — correctly handles duplicate events.
- Schema has unique index `(sourceType, sourceId, organizationId)` — proper dedup constraint.
- Constructor tests include edge cases (empty strings, whitespace-only notes).
- Repository uses `traceAsync` for observability — consistent with project conventions.
- Redis adapter tests are thorough (increment from zero, decrement negative, per-org/user isolation).

## Remaining Issues (next iteration)

- M1–M4 still need fixing
- m3, m4 should be addressed
- No integration tests with real DB yet (tests use factory function return-type checks)
- Frontend `react-hooks/exhaustive-deps` ESLint rule is missing from project config (not inbox-specific)
