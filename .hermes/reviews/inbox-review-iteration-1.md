# Phase 11 Inbox Review — Iteration 1

Date: 2025-07-09
Reviewer: Senior Code Review Agent (automated)
Base commit: 38f7b2e (all inbox files staged, uncommitted)
Files reviewed: 42

## Summary

The inbox bounded context implementation follows the project's hexagonal architecture correctly at the structural level — domain types are pure, ports are interfaces, adapters implement ports, and the build function wires everything. The domain layer (types, rules, constructors, events, errors) is clean and well-structured.

However, there are **two critical security/architecture issues** that must be addressed before merge:

1. **All 7 server functions accept `organizationId` from the client payload** instead of resolving it from the authenticated session via `resolveTenantContext`. Every other tenant-aware context (portal, identity, integration, property, staff, team) uses `resolveTenantContext`. A malicious user can pass any organizationId and access/modify another tenant's inbox items. This is a **tenant isolation bypass**.

2. **`getInboxItemDetail` bypasses the use case layer** — it accesses `inboxRepo` directly from the server function. This violates the hexagonal architecture rule that server functions should call use cases, not repositories.

Beyond those, there are medium issues: the `on-review-updated` event handler uses an unsafe `as string` cast on a branded ID, the `unread count` fallback logic silently returns 0 when Redis is unavailable and there are no 'new' items (even if there are unread 'escalated' items), and the repository tests are trivially thin (compile-check only, no behavior tests).

## Critical Issues (must fix)

| # | File | Issue | Severity |
|---|------|-------|----------|
| C1 | `src/contexts/inbox/server/inbox.ts` | **Tenant isolation bypass**: All 7 server functions trust `organizationId` from client payload. Must use `resolveTenantContext(headers)` like every other context. | CRITICAL |
| C2 | `src/contexts/inbox/server/inbox.ts` (line 207-212) | `getInboxItemDetail` accesses `inboxRepo` directly instead of going through a use case. Server layer must only call use cases. | CRITICAL |
| C3 | `src/contexts/inbox/server/inbox.ts` (line 81-83, 106-109, etc.) | `userId` comes from client payload (same as organizationId). Authenticated user ID must come from session context, not request body. | CRITICAL |

## Medium Issues (should fix)

| # | File | Issue | Severity |
|---|------|-------|----------|
| M1 | `src/contexts/inbox/infrastructure/event-handlers/on-review-updated.ts` (line 18) | `event.reviewId as string` — unsafe cast of branded ID. Should use the branded ID directly or an explicit unbrand utility. | MEDIUM |
| M2 | `src/contexts/inbox/infrastructure/repositories/inbox.repository.ts` (line 155) | `ids as unknown as string[]` — unsafe double-cast to satisfy Drizzle's `inArray`. Should map branded IDs to strings explicitly. | MEDIUM |
| M3 | `src/contexts/inbox/application/use-cases/create-inbox-item.ts` (line 45) | `input.sourceId as string` — same unsafe branded→string cast. | MEDIUM |
| M4 | `src/contexts/inbox/application/use-cases/create-inbox-item.ts` (line 87) | `sourceId: item.sourceId as string` — unsafe cast in event emission. | MEDIUM |
| M5 | `src/contexts/inbox/application/use-cases/bulk-update-inbox-status.ts` (lines 69-71) | Unread counter decremented one-at-a-time in a loop instead of using a batch decrement. 100 items = 100 Redis calls. | MEDIUM |
| M6 | `src/contexts/inbox/application/use-cases/get-unread-count.ts` (line 26) | Returns count > 0 from Redis, but if count === 0, falls through to repo `countByStatus('new')`. This means Redis returning 0 (legitimately no unread items) triggers an unnecessary DB query every time. Should trust Redis 0 value. | MEDIUM |
| M7 | `src/contexts/inbox/infrastructure/repositories/inbox.repository.ts` (lines 119-126) | `updateStatus` uses `new Date()` for `updatedAt` instead of the injected clock. Same in `bulkUpdateStatus` (line 149), `updateAssignment` (line 170), `syncDenormalizedFields` (line 206). Time source inconsistency. | MEDIUM |
| M8 | Repository test files | `inbox.repository.test.ts` and `inbox-note.repository.test.ts` only verify that factory functions return the right shape. No behavioral tests (tenant isolation, pagination, cursor logic). Tests pass even if implementation is completely broken. | MEDIUM |

## Minor Issues (nice to fix)

| # | File | Issue | Severity |
|---|------|-------|----------|
| m1 | `src/contexts/inbox/server/inbox.ts` (lines 81, 106, 134, 162, 187) | Use cases call branded constructors (`organizationId()`, `userId()`) in server layer — redundant since tenant context would provide branded IDs. | MINOR |
| m2 | `src/contexts/inbox/application/dto/inbox.dto.ts` | `assignInboxItemDto` has `role: z.string().min(1)` but should validate against known roles (owner, admin, manager). | MINOR |
| m3 | `src/contexts/inbox/application/use-cases/bulk-update-inbox-status.ts` (line 80) | `oldStatuses.get(id)!` — non-null assertion after a `Map.get()`. While safe due to the earlier `.set()`, the `!` is unnecessary if we restructure. | MINOR |
| m4 | `src/contexts/inbox/server/inbox.ts` (line 55) | `JSON.parse(Buffer.from(data.cursor, 'base64').toString('utf-8'))` — cursor deserialization has no try/catch for malformed input. A bad cursor would throw an unhandled error. | MINOR |
| m5 | `src/routes/_authenticated/inbox/index.tsx` (line 28) | `items.map((i) => i.id)` — `i.id` is a branded InboxItemId used as a plain string for `selectedIds`. Type coercion works but loses type safety. | MINOR |
| m6 | `src/contexts/inbox/domain/events.ts` | Event factory functions use branded IDs but emit events where `sourceId` is cast to string. Inconsistent with other contexts' event patterns. | MINOR |

## Positive Notes

- **Domain layer is textbook**: Types use `Readonly<>`, errors use tagged pattern, rules return `Result`, constructors validate input. Clean hexagonal separation.
- **Status machine is well-designed**: The transition rules in `rules.ts` cover all valid paths including edge cases like `archived → read` (reopen). Tests for rules are thorough (157 lines).
- **Event handlers are properly idempotent**: `on-review-created` and `on-feedback-submitted` both catch `already_exists` and return silently. All handlers catch and log, never throw.
- **Schema design is correct**: `inbox_items_source_unique` unique index includes `organizationId` — proper tenant isolation at DB level. Foreign key cascade on `inbox_notes` is correct.
- **Cursor-based pagination** is properly implemented with `(sourceDate, id) < (cursor.sourceDate, cursor.id)` tuple comparison and `LIMIT + 1` lookahead pattern.
- **Redis fallback**: When Redis is unavailable, the unread counter gracefully falls back to DB count. The null-redis path in `build.ts` provides a no-op counter for development.
- **DI wiring in `build.ts`** is clean: single factory function, typed deps, immediate registration of event handlers.
