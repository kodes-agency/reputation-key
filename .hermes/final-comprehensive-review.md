# Final Comprehensive Review — reputation-key (hong-kong)

**Date:** 2026-05-22
**Scope:** Full codebase audit across 6 axes
**Contexts:** 11 (dashboard, guest, identity, inbox, integration, metric, portal, property, review, staff, team)

---

## Executive Summary

| Axis | Verdict | P0 | P1 | P2 | P3 |
|------|---------|----|----|----|----|
| Build & Type Safety | ✅ Clean | 0 | 0 | 12 | ~15 |
| Architecture & Layers | ✅ Excellent | 0 | 0 | 1 | 1 |
| Security & Multi-tenancy | ⚠️ Minor gaps | 0 | 2 | 3 | 4 |
| Test Health | ⚠️ 11 failures | 1 | 1 | 0 | 0 |
| Code Quality | ⚠️ Systemic gaps | 0 | 0 | 17 | 7 |
| Documentation | ⚠️ Stale docs | 0 | 3 | 10 | 12 |
| **Total** | | **1** | **6** | **43** | **39** |

**Overall:** Codebase is architecturally sound. No P0 build issues. All P1s are actionable. Main systemic issue: 15/17 repos missing `trace()` observability wrapping.

---

## 1. Build & Type Safety ✅

**`tsc --noEmit`:** 0 errors. Clean build.

**Unsafe patterns in production code:**
- `as any`: 0
- `@ts-ignore` / `@ts-expect-error`: 0
- `as unknown as` (double cast): 0
- `enum` declarations: 0
- Loose `Function` / `Object` types: 0

### P2 — `id as string` instead of `unbrand()` (12 locations)

Infrastructure mappers/repos bypass `unbrand()`:

| # | File | Line |
|---|------|------|
| 1 | `staff/infrastructure/mappers/staff-assignment.mapper.ts` | 30 |
| 2 | `staff/infrastructure/repositories/staff-assignment.repository.ts` | 27 |
| 3 | `staff/infrastructure/repositories/staff-assignment.repository.ts` | 122 |
| 4 | `guest/infrastructure/mappers/guest.mapper.ts` | 4 |
| 5 | `guest/infrastructure/mappers/guest.mapper.ts` | 15 |
| 6 | `guest/infrastructure/mappers/guest.mapper.ts` | 27 |
| 7 | `review/infrastructure/mappers/reply.mapper.ts` | 31 |
| 8 | `review/infrastructure/mappers/review.mapper.ts` | 33 |
| 9 | `team/infrastructure/mappers/team.mapper.ts` | 24 |
| 10 | `team/infrastructure/repositories/team.repository.ts` | 28 |
| 11 | `team/infrastructure/repositories/team.repository.ts` | 87 |
| 12 | `team/infrastructure/repositories/team.repository.ts` | 97 |

### P3 — Raw `string` at UI/API boundary (~15 locations)

- `src/lib/lookups.ts` — `userId: string`, `teamId: string`
- `src/components/features/team/shared/types.ts` — `userId: string`, `teamId: string`
- `src/components/features/portal/` — `portalId: string` in several hooks
- `src/routes/api/webhooks/gbp/notifications.ts:38` — `messageId: string`

**Fix:** Replace all `id as string` with `unbrand()` from `#/shared/domain/ids`. UI boundary types are acceptable as P3.

---

## 2. Architecture & Layers ✅

**Dependency direction:** ZERO violations across all 11 contexts. Strict domain ← application ← infrastructure ← server.

**Domain purity:** ZERO violations. All domain files are data-only (Readonly types, pure constructors, pure validation). No async, no classes, no DB/HTTP imports.

**Composition root:** `src/composition.ts` wires all 11 contexts with manual DI in correct order. Each context has a `build.ts`.

### P2 — Cross-context import violation (1)

| File | Issue |
|------|-------|
| `integration/infrastructure/adapters/property-event.adapter.ts:7` | Imports `propertyCreated` directly from `property/domain/events` instead of public-api barrel |

**Fix:** Import from `property/application/public-api` instead.

### P3 — Missing port export (1)

| File | Issue |
|------|-------|
| `integration/infrastructure/adapters/google-review-api.adapter.ts:5` | Imports `GoogleReviewApiPort` directly from `review/application/ports/` because it's not exported from `review/application/public-api` |

**Fix:** Add `GoogleReviewApiPort` to `review/application/public-api.ts` re-exports.

### Missing public-api barrels (4 contexts)

`guest`, `identity`, `metric`, `team` have no `application/public-api.ts`. Only `guest` has cross-context consumers (event-type imports — allowed). Consider adding barrels as contexts grow.

---

## 3. Security & Multi-tenancy ⚠️

### P1 — Inbox mutations lack authorization (1 finding, affects 4 endpoints)

All 4 inbox POST endpoints (`markRead`, `markUnread`, `dismiss`, `bulkUpdate`) have no `can()` permission check. Any authenticated org member can mutate inbox items.

**Files:** `src/contexts/inbox/server/inbox.ts`

**Fix:** Add `can(ctx.role, 'inbox.update')` after auth resolution for all mutation endpoints.

### P1 — `findByGbpPlaceId` has no orgId filter

| File | Line | Issue |
|------|------|-------|
| `property/infrastructure/repositories/property.repository.ts` | 102 | Used by webhook handler — cross-org lookup by GBP place ID. Intentional but needs defense-in-depth comment documenting why. |

### P2 — `deleteByConnectionId` missing orgId (1)

| File | Line | Issue |
|------|------|-------|
| `integration/infrastructure/repositories/gbp-cache.repository.ts` | 84 | DELETE query lacks `organizationId` in WHERE clause. If connection ID is globally unique it's safe, but explicit orgId is defense-in-depth. |

### P2 — Read-only endpoints lack `can()` (various)

GET endpoints across contexts have auth check but no explicit `can()` for read permission. Any org member can read all data. By design for now but should be locked down as roles expand.

### P2 — `auth-settings.ts` bypasses `resolveTenantContext`

| File | Issue |
|------|-------|
| `identity/server/auth-settings.ts` | Uses better-auth directly instead of `resolveTenantContext` pattern |

### Positives
- `baseWhere()` helper enforces orgId + soft-delete on major tables
- All upsert conflict targets include `organizationId`
- `tracedHandler` prevents raw error leakage
- Webhook route verifies Google Pub/Sub JWT
- `catchUntagged()` returns generic 500s

---

## 4. Test Health ⚠️

### Suite results

| Metric | Count |
|--------|-------|
| Test files | 150 total, 2 failed, 148 passed |
| Tests | 1,300 total, 11 failed, 1,289 passed |
| Pass rate | **99.2%** |

### P1 — Integration test failures (11 tests, 2 files)

**Root cause:** `column "approved_by" of relation "replies" does not exist`. Drizzle schema references columns (`approved_by`, `rejected_by`, `rejection_reason`) that haven't been migrated to the test database.

**Failed files:**
- `src/contexts/property/infrastructure/repositories/property.repository.test.ts` (1 failure)
- `src/contexts/review/infrastructure/repositories/reply.repository.test.ts` (10 failures)

**Fix:** Run pending migrations on the test database. Schema in code is ahead of DB.

### Test coverage per context

| Context | Test files |
|---------|-----------|
| portal | 24 |
| integration | 24 |
| inbox | 17 |
| identity | 13 |
| property | 12 |
| team | 11 |
| review | 11 |
| guest | 10 |
| staff | 9 |
| metric | 7 |
| dashboard | 2 |

**All 3 new test files pass:** 23/23 tests green (in-memory unit tests, no DB dependency).

---

## 5. Code Quality ⚠️

### P1 — Class violations (2)

| File | Line | Issue |
|------|------|-------|
| `integration/application/ports/google-connection.repository.ts` | 14 | `class UniqueViolationError extends Error` — violates tagged-object convention |
| `integration/application/ports/property-import-repo.port.ts` | 7 | `class DuplicateKeyError extends Error` — same violation |

**Fix:** Replace with tagged discriminated union types: `{ _tag: 'UniqueViolationError', message: string }` + type guard.

### P2 — Missing `trace()` in 15/17 repositories

Only `inbox.repository.ts` and `inbox-note.repository.ts` use `trace()`. All others lack observability wrapping:

| Missing trace() | Context |
|-----------------|---------|
| dashboard.repository.ts | dashboard |
| guest-interaction.repository.ts | guest |
| gbp-cache.repository.ts | integration |
| gbp-import.repository.ts | integration |
| google-connection.repository.ts | integration |
| property-import.repository.ts | integration |
| metric.repository.ts | metric |
| link-resolver.repository.ts | portal |
| portal-link.repository.ts | portal |
| portal.repository.ts | portal |
| property.repository.ts | property |
| reply.repository.ts | review |
| review.repository.ts | review |
| staff-assignment.repository.ts | staff |
| team.repository.ts | team |

**Fix:** Wrap every repo method in `trace('context.<method>', ...)`. Follow `inbox.repository.ts` as the reference pattern.

### P2 — Bare `catch {}` without logging (6 locations)

| File | Line | Issue |
|------|------|-------|
| `inbox/application/use-cases/get-unread-count.ts` | 43 | Cache warm failure not logged |
| `inbox/application/use-cases/update-inbox-status.ts` | 90 | Counter unavailable not logged |
| `inbox/application/use-cases/bulk-update-inbox-status.ts` | 55 | Access check failure silently returns `{ updated: 0 }` |
| `inbox/application/use-cases/bulk-update-inbox-status.ts` | 106 | Counter unavailable in bulk flow |
| `inbox/application/use-cases/create-inbox-item.ts` | 86 | Does log but catch has no `err` binding |
| `integration/application/use-cases/list-gbp-locations.ts` | 119 | Retry failure not logged |

**Fix:** Add `logger.warn({ err, ...context })` inside each catch.

### P2 — Missing `baseWhere()` in 8 repositories

| Repos missing baseWhere() | Context |
|---------------------------|---------|
| inbox.repository.ts | inbox |
| guest-interaction.repository.ts | guest |
| google-connection.repository.ts | integration |
| gbp-import.repository.ts | integration |
| property-import.repository.ts | integration |
| gbp-cache.repository.ts | integration |
| dashboard.repository.ts | dashboard |
| metric.repository.ts | metric |

Note: Some tables may not have `deletedAt` columns — verify before adding.

### Clean areas
- ✅ Zero `throw new Error()` in server layer
- ✅ Zero `console.log/warn/error` in production code
- ✅ Zero `export *` barrel files
- ✅ All filenames kebab-case
- ✅ All upserts use `onConflictDoUpdate`
- ✅ Consistent `_tag`-based error types across 9/10 contexts

---

## 6. Documentation ⚠️

### P1 — Stale ADR statuses (3)

| ADR | Claimed | Actual |
|-----|---------|--------|
| 0002 (Section-Based Navigation) | "Proposed" | Fully implemented |
| 0003 (Review Bounded Context) | "Proposed" | Fully implemented |
| 0004 (Inbox Bounded Context) | "Proposed" | Fully implemented |

**Fix:** Update all three to status "Implemented".

### P2 — Root CONTEXT.md inaccurate (3 issues)

| Issue | Detail |
|-------|--------|
| Outdated context count | Says "Six bounded contexts" — should be "Eleven" |
| Missing Staff in table | Bounded contexts table lists 10, omits Staff |
| ADR table incomplete | Lists ADRs 0001–0004, missing ADR 0005 |

### P2 — Plan phase status stale (2)

| Phase | Plan Status | Codebase Reality |
|-------|-------------|------------------|
| Phase 13 (Metrics) | "Next up" | Substantially implemented (5 handlers, repo, use case, tests) |
| Phase 14 (Dashboard) | "Pending" | Partially implemented (use case, repo, server fn, tests) |

### P2 — Other doc issues (12 total)

- `src/components/CONTEXT.md` missing `integration/` and `settings/` feature folders
- `src/shared/CONTEXT.md` lists nonexistent `rate-limit/` directory, missing 10 testing fakes
- `src/routes/CONTEXT.md` missing inbox, register, reset-password, import routes
- ADR 0003 decision to move property import never implemented
- No ADRs for Staff context separation or Dashboard as read-only context

---

## Prioritized Fix List

### Must fix (P1 — 6 items)

1. **Inbox `can()` check** — Add `can(ctx.role, 'inbox.update')` to 4 mutation endpoints
2. **ADR statuses** — Update 0002, 0003, 0004 to "Implemented"
3. **Schema migration** — Run pending migrations on test DB (fixes 11 failing tests)
4. **Class violations** — Replace 2 `class extends Error` with tagged unions
5. **Root CONTEXT.md** — Fix "Six" → "Eleven", add Staff, add ADR 0005

### Should fix (P2 — 43 items)

6. **`trace()` wrapping** — Add to 15 repositories (biggest single effort)
7. **`unbrand()` usage** — Replace 12 `id as string` in mappers/repos
8. **Bare catch logging** — Add `logger.warn()` to 6 catch blocks
9. **`baseWhere()` audit** — Verify tenant isolation in 8 repos missing it
10. **Cross-context import** — Fix `property-event.adapter.ts` to use public-api
11. **Plan status** — Update Phase 13/14 to "In progress"
12. **CONTEXT.md updates** — Fix 12 inaccuracies across 4 CONTEXT.md files
13. **`deleteByConnectionId` orgId** — Add defense-in-depth filter
14. **`findByGbpPlaceId` comment** — Document intentional cross-org lookup

### Nice to have (P3 — 39 items)

15. UI boundary types — Add branded IDs to component props (~15 locations)
16. Test utilities — Use `unbrand()` in in-memory test doubles
17. Missing public-api barrels — Add to guest, identity, metric, team
18. Missing ADRs — Consider ADRs for Staff separation, Dashboard pattern
19. Missing `errors.ts` — Add `DashboardError` type

---

## Clean Areas Worth Noting

- **Zero build errors** — `tsc --noEmit` clean
- **Zero unsafe type escapes** — no `as any`, no `@ts-ignore` in production
- **Perfect layer separation** — no upward imports anywhere
- **Pure domains** — no async, no classes, no IO in domain layer
- **Proper DI** — manual composition root, no service locator
- **No error leakage** — `throwContextError` + `catchUntagged` everywhere
- **No console.log** — all logging via `getLogger()`
- **No barrel re-exports** — no `export *` in contexts
- **1,289/1,300 tests pass** — 99.2% pass rate
- **Webhook JWT verification** — Google Pub/Sub tokens validated
