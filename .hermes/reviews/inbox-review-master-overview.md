# Phase 11 Inbox Review — Master Overview

Date: 2026-05-19
Total iterations: 4
Total issues found: 31 (5 critical, 13 medium, 13 minor)
Total issues fixed: 27

## Iteration Summaries

### Iteration 1

- Issues found: 10 (2 critical, 4 medium, 4 minor)
- Issues fixed: 6 (all critical + medium partial)
- Key findings: Server functions trusted client-sent `organizationId`/`userId` instead of resolving from authenticated session. `getInboxItemDetail` bypassed application layer. Test mocks used `any` casts. Redis decrement could go negative.
- Key fixes: Rewrote all 7 server functions to use `resolveTenantContext()`. Created `get-inbox-item-detail` use case. Fixed `inboxItemId()` used for `userId`. Added `.inputValidator()` to all server functions.

### Iteration 2

- Issues found: 10 (2 critical, 5 medium, 4 minor)
- Issues fixed: 6
- Key findings: Test data used `as any` for branded IDs. Redis `DECR` could go negative. Missing `organizationId` in property index. Unsafe `null as UserId | null` cast. Missing test for `get-inbox-item-detail`.
- Key fixes: Replaced `any` casts with typed factory. Implemented Lua script for floor-at-0 decrement. Added `organizationId` to property index. Typed null assignment. Added boundary comments for branded ID unbranding.

### Iteration 3

- Issues found: 13 (3 critical, 5 medium, 5 minor)
- Issues fixed: 10
- Key findings: Frontend passed `organizationId`/`userId` in client payloads (silently stripped by Zod). Unsafe `as` casts in components. Duplicated `formatDate` utility. `updateStatusDto` allowed `'new'` status. Event handlers used dynamic imports instead of static.
- Key fixes: Removed client-side org/user payloads from all components. Restricted `updateStatusDto` to exclude `'new'`. Extracted shared `formatDate` to `utils.ts`. Converted event handler imports to static. Added `getLogger` import convention. Removed `archived → read` from UI helpers.

### Iteration 4

- Issues found: 8 (2 critical, 4 medium, 2 minor)
- Issues fixed: 5 (critical + medium; 1 medium was false positive, 2 minor deferred)
- Key findings: Unread counter decrement only fired on `new → read` but should fire on all `new → *` transitions. `on-review-updated.ts` still had dynamic import (missed in iteration 3). `archived` state allowed `→ read` in domain rules but UI blocked it — inconsistency. Redis counter was never warmed from DB fallback.
- Key fixes: Expanded decrement to all `new → *` transitions (both single and bulk). Added cache warming in `getUnreadCount` via `setCount()` on DB fallback. Converted `on-review-updated.ts` to static import. Made `archived` a terminal state in domain rules. Added exception comment for direct server import in deep component.

## Convergence Analysis

Issue counts per iteration: 10 → 10 → 13 → 8

The count didn't strictly decrease — iteration 3 found more issues than iteration 2 because each review is independent with fresh eyes. Iteration 3 caught frontend issues that iterations 1-2 (focused on backend) missed. However, the **severity** clearly decreased:

- Iteration 1: tenant isolation vulnerability (ship-blocker)
- Iteration 2: data integrity (negative counters), type safety
- Iteration 3: frontend type safety, client payloads
- Iteration 4: functional correctness gap (decrement coverage), consistency

The hardest issues to eliminate were consistency problems (dynamic vs static imports, domain rules vs UI alignment) — these required domain knowledge to spot and recurred across files.

## Architecture Assessment

- **Overall code quality: 4/5** — Clean hexagonal architecture, pure domain, proper Result types, good error handling. Docked one point for the unread counter cache design needing refinement (org vs user scope).
- **Convention adherence: 4.5/5** — Excellent consistency with project patterns after fixes. Branded IDs, tagged errors, server function patterns all correct. Minor dock for one missed dynamic import.
- **Test quality: 3.5/5** — 1170 tests passing, domain/use case coverage is thorough. Missing: `get-inbox-item-detail` use case has no tests, no integration tests with real DB, component tests are absent.
- **Tenant isolation: 5/5** — Every single DB query includes `organizationId`. Server functions resolve from session, never from client input. DTOs validate but don't include identity fields. Schema unique constraints include `organizationId`.
- **Naming consistency: 4.5/5** — Consistent naming across domain/application/infrastructure. `useCase` suffix, `Deps` types, `Input` types. Minor dock for `inbox-detail-helpers.tsx` naming (could be more specific).

## Remaining Concerns

1. **Unread counter org vs user scope**: The Redis counter is keyed by `(orgId, userId)` but inbox items are org-wide. The cache warming fix (iteration 4) helps, but the fundamental design has a mismatch — when user A reads items, user B's cached count stays stale until next DB fallback. This needs a design decision: switch to org-level counter keys, or accept the trade-off.

2. **`get-inbox-item-detail` has no tests**: Only use case without tests. Should be addressed when integration test infrastructure is set up.

3. **No integration tests with real DB**: All repo tests are structural/compile-time. Integration tests with actual PostgreSQL would catch query bugs.

4. **Truncated UUID in notes thread**: `note.authorUserId.slice(0, 8)…` is user-hostile. Needs user data integration.

5. **Hardcoded platforms list**: `inbox-filters.tsx` has a static platform array. Should be sourced from backend or shared constants.

6. **Unused `events` dep in event handlers**: `OnReviewCreatedDeps` and `OnFeedbackSubmittedDeps` include `events: EventBus` but handlers never call `deps.events`.

## Recommendations

1. **Design the unread counter scope properly** — Decide whether counters should be per-org or per-user. If per-user (for "mark as seen" per user), the cache warming approach is correct but needs a cache invalidation strategy. If per-org (current actual behavior), simplify the port to `(orgId)` only.

2. **Add integration tests** — Set up a test PostgreSQL instance (or use the existing test infra) and write integration tests for the repository layer, especially around cursor pagination and tenant isolation.

3. **Extract shared filter constants** — Move platform list and status lists to a shared constants file to avoid frontend/backend drift.

4. **Add `get-inbox-item-detail` tests** — Create test file with in-memory port mocks matching the other use case test patterns.

5. **Consider removing unused event bus from handler deps** — Clean up `events` from `OnReviewCreatedDeps`/`OnFeedbackSubmittedDeps` since they never emit events.
