# Final Review Fix-All Implementation Plan

> **For Hermes:** Execute via delegate_task subagents. Group parallel-safe tasks into batches.

**Goal:** Fix all 89 findings from the comprehensive final review (6 P1, 43 P2, 39 P3).

**Architecture:** Hexagonal TypeScript — 11 bounded contexts. Repos use Drizzle ORM. Server functions use tracedHandler + can() + throwContextError. Errors are tagged objects.

**Reference patterns:**
- `trace()` wrapping: see `src/contexts/inbox/infrastructure/repositories/inbox.repository.ts`
- `unbrand()`: `import { unbrand } from '#/shared/domain/ids'` — replaces `id as string`
- `can()`: `can(ctx.role, 'permission.name')` from `#/shared/auth/permissions`
- Tagged errors: `createErrorFactory` from `#/shared/domain/errors`
- `throwContextError`: from `#/shared/auth/server-errors`

---

## Batch 1 — P1 Fixes (sequential, touching shared files)

### Task 1: Add inbox permissions to Permission type and statement

**TDD:** Skip — type/constant additions, no behavior change.

**Files:**
- Modify: `src/shared/domain/permissions.ts`
- Modify: `src/shared/auth/permissions.ts`

**Steps:**

1. Add `inbox.read` and `inbox.update` to the `Permission` union type in `src/shared/domain/permissions.ts`
2. Add corresponding entries to the permission `statement` in `src/shared/auth/permissions.ts`:
   - `{ action: 'read', resource: 'inbox' }` for owner/admin/member
   - `{ action: 'update', resource: 'inbox' }` for owner/admin/member
3. Run: `npx tsc --noEmit` — expect clean

### Task 2: Add can() checks to inbox server mutations

**TDD:** Skip — authorization guard, tested via existing integration tests.

**Files:**
- Modify: `src/contexts/inbox/server/inbox.ts`

**Steps:**

1. Import `can` from `#/shared/auth/permissions` (already imported in other server files)
2. Add `can(ctx.role, 'inbox.update')` to the 4 mutation handlers: `markReadFn`, `markUnreadFn`, `dismissFn`, `bulkUpdateFn`
   - Place after `resolveTenantContext(headers)` call, before use case invocation
   - Pattern: `if (!can(ctx.role, 'inbox.update')) throwContextError('AuthError', { code: 'forbidden', message: 'No inbox update permission' }, 403)`
3. Run: `npx tsc --noEmit` — expect clean

### Task 3: Replace class error extensions with tagged unions

**TDD:** Skip — error type refactor, existing tests validate behavior.

**Files:**
- Modify: `src/contexts/integration/application/ports/google-connection.repository.ts`
- Modify: `src/contexts/integration/application/ports/property-import-repo.port.ts`
- Modify: All consumers of `UniqueViolationError` and `DuplicateKeyError` (grep for imports)

**Steps:**

1. In `google-connection.repository.ts`:
   - Remove `class UniqueViolationError extends Error`
   - Replace with tagged type:
     ```ts
     export type UniqueViolationError = Readonly<{
       _tag: 'UniqueViolationError'
       code: 'unique_violation'
       message: string
     }>
     export const uniqueViolationError = (message: string): UniqueViolationError => ({
       _tag: 'UniqueViolationError',
       code: 'unique_violation',
       message,
     })
     export const isUniqueViolationError = (e: unknown): e is UniqueViolationError =>
       typeof e === 'object' && e !== null && (e as UniqueViolationError)._tag === 'UniqueViolationError'
     ```
   - Replace `throw new UniqueViolationError(msg)` with `throw uniqueViolationError(msg)`
   - Update all consumers: change `e instanceof UniqueViolationError` to `isUniqueViolationError(e)`

2. In `property-import-repo.port.ts`:
   - Same pattern for `DuplicateKeyError`

3. Run: `npx tsc --noEmit` — expect clean
4. Run: `node_modules/.bin/vitest run src/contexts/integration/` — expect all pass

### Task 4: Add defense-in-depth comment to findByGbpPlaceId

**TDD:** Skip — documentation only.

**Files:**
- Modify: `src/contexts/property/infrastructure/repositories/property.repository.ts`

**Steps:**

1. Add comment above `findByGbpPlaceId` method:
   ```ts
   // Intentional cross-org lookup: GBP webhook identifies properties by placeId,
   // not orgId. The webhook handler verifies Google Pub/Sub JWT before calling this.
   // Caller is responsible for org-scoping the result.
   ```

### Task 5: Add orgId to gbp-cache deleteByConnectionId

**TDD:** Write test first.

**Files:**
- Modify: `src/contexts/integration/infrastructure/repositories/gbp-cache.repository.ts`
- Test: existing or new test for delete isolation

**Steps:**

1. Add `organizationId` parameter to `deleteByConnectionId(orgId, connectionId)` signature
2. Add `eq(schema.organizationId, orgId)` to the DELETE WHERE clause
3. Update the caller (in build.ts or use case) to pass orgId
4. Run: `npx tsc --noEmit` — expect clean

---

## Batch 2 — P2: trace() Wrapping (15 repos, parallel-safe groups)

**Pattern for every repo:**
```ts
import { trace } from '#/shared/observability/trace'

// Wrap each method body:
methodName: async (args) => {
  return trace('context.methodName', async () => {
    // existing method body unchanged
  })
},
```

### Task 6: Add trace() to dashboard.repository.ts
- File: `src/contexts/dashboard/infrastructure/repositories/dashboard.repository.ts`

### Task 7: Add trace() to guest-interaction.repository.ts
- File: `src/contexts/guest/infrastructure/repositories/guest-interaction.repository.ts`

### Task 8: Add trace() to gbp-cache.repository.ts
- File: `src/contexts/integration/infrastructure/repositories/gbp-cache.repository.ts`

### Task 9: Add trace() to gbp-import.repository.ts
- File: `src/contexts/integration/infrastructure/repositories/gbp-import.repository.ts`

### Task 10: Add trace() to google-connection.repository.ts
- File: `src/contexts/integration/infrastructure/repositories/google-connection.repository.ts`

### Task 11: Add trace() to property-import.repository.ts
- File: `src/contexts/integration/infrastructure/repositories/property-import.repository.ts`

### Task 12: Add trace() to metric.repository.ts
- File: `src/contexts/metric/infrastructure/repositories/metric.repository.ts`

### Task 13: Add trace() to link-resolver.repository.ts
- File: `src/contexts/portal/infrastructure/repositories/link-resolver.repository.ts`

### Task 14: Add trace() to portal-link.repository.ts
- File: `src/contexts/portal/infrastructure/repositories/portal-link.repository.ts`

### Task 15: Add trace() to portal.repository.ts
- File: `src/contexts/portal/infrastructure/repositories/portal.repository.ts`

### Task 16: Add trace() to property.repository.ts
- File: `src/contexts/property/infrastructure/repositories/property.repository.ts`

### Task 17: Add trace() to reply.repository.ts
- File: `src/contexts/review/infrastructure/repositories/reply.repository.ts`

### Task 18: Add trace() to review.repository.ts
- File: `src/contexts/review/infrastructure/repositories/review.repository.ts`

### Task 19: Add trace() to staff-assignment.repository.ts
- File: `src/contexts/staff/infrastructure/repositories/staff-assignment.repository.ts`

### Task 20: Add trace() to team.repository.ts
- File: `src/contexts/team/infrastructure/repositories/team.repository.ts`

**Each task follows same steps:**
1. Add `import { trace } from '#/shared/observability/trace'` at top
2. Wrap every method body in `trace('context.methodName', async () => { ... })`
3. Run: `npx tsc --noEmit` — expect clean
4. Run repo's tests if they exist: `node_modules/.bin/vitest run <path>`

**Parallel execution:** Tasks 6–20 are independent (different files). Run in batches of 3.

---

## Batch 3 — P2: unbrand() Replacements (12 locations)

### Task 21: Replace `id as string` with `unbrand()` in staff mappers/repos

**Files:**
- `src/contexts/staff/infrastructure/mappers/staff-assignment.mapper.ts` (line 30)
- `src/contexts/staff/infrastructure/repositories/staff-assignment.repository.ts` (lines 27, 122)

**Steps:**
1. Add `import { unbrand } from '#/shared/domain/ids'`
2. Replace `id as string` → `unbrand(id)` at all locations
3. Replace `assignment.id as string` → `unbrand(assignment.id)`

### Task 22: Replace `id as string` with `unbrand()` in guest mappers

**Files:**
- `src/contexts/guest/infrastructure/mappers/guest.mapper.ts` (lines 4, 15, 27)

**Steps:** Same pattern — add import, replace 3 occurrences.

### Task 23: Replace `id as string` with `unbrand()` in review mappers

**Files:**
- `src/contexts/review/infrastructure/mappers/reply.mapper.ts` (line 31)
- `src/contexts/review/infrastructure/mappers/review.mapper.ts` (line 33)

**Steps:** Same pattern — add import, replace 2 occurrences.

### Task 24: Replace `id as string` with `unbrand()` in team mappers/repos

**Files:**
- `src/contexts/team/infrastructure/mappers/team.mapper.ts` (line 24)
- `src/contexts/team/infrastructure/repositories/team.repository.ts` (lines 28, 87, 97)

**Steps:** Same pattern — add import, replace 4 occurrences.

**Parallel execution:** Tasks 21–24 are independent. Run all in parallel.

**Verify batch:** `npx tsc --noEmit` after all complete.

---

## Batch 4 — P2: Bare Catch Logging (6 locations)

### Task 25: Add logger.warn to inbox use case catch blocks

**Files:**
- `src/contexts/inbox/application/use-cases/get-unread-count.ts` (line 43)
- `src/contexts/inbox/application/use-cases/update-inbox-status.ts` (line 90)
- `src/contexts/inbox/application/use-cases/bulk-update-inbox-status.ts` (lines 55, 106)
- `src/contexts/inbox/application/use-cases/create-inbox-item.ts` (line 86)

**Steps for each:**
1. Ensure `deps.logger` is available (already injected in all inbox use cases)
2. Change `catch {}` → `catch (err)` (or add `err` binding if missing)
3. Add `deps.logger.warn({ err, organizationId }, 'Description of what failed')` as first line in catch
4. Keep existing fallback return behavior unchanged

### Task 26: Add logger.warn to list-gbp-locations catch block

**Files:**
- `src/contexts/integration/application/use-cases/list-gbp-locations.ts` (line 119)

**Steps:**
1. Change `catch {}` → `catch (err)`
2. Add `deps.logger.warn({ err }, 'Wildcard location list failed, retrying')` before re-throw

**Verify batch:** `npx tsc --noEmit`

---

## Batch 5 — P2: Cross-Context Import Fix

### Task 27: Fix property-event.adapter.ts to use public-api barrel

**Files:**
- Modify: `src/contexts/integration/infrastructure/adapters/property-event.adapter.ts`
- Modify: `src/contexts/property/application/public-api.ts` (add export if missing)

**Steps:**
1. Check if `propertyCreated` is exported from `property/application/public-api.ts`
2. If not, add it: `export { propertyCreated } from './domain/events'` (or correct relative path)
3. Change import in adapter from `property/domain/events` → `property/application/public-api`
4. Run: `npx tsc --noEmit`

### Task 28: Export GoogleReviewApiPort from review public-api

**Files:**
- Modify: `src/contexts/review/application/public-api.ts`

**Steps:**
1. Add `export type { GoogleReviewApiPort } from './ports/google-review-api.port'`
2. Update import in `integration/infrastructure/adapters/google-review-api.adapter.ts` to use public-api
3. Run: `npx tsc --noEmit`

---

## Batch 6 — P1: Fix Failing Integration Tests (schema migration)

### Task 29: Run Drizzle migration on test database

**Steps:**
1. Check pending migrations: `npx drizzle-kit migrate` (dry run or check migration files)
2. The `replies` table is missing `approved_by`, `rejected_by`, `rejection_reason` columns
3. Verify migration file exists in `drizzle/` directory for these columns
4. Run migration against test DB: `DATABASE_URL=postgresql://test:test@localhost:5432/test npx drizzle-kit migrate`
5. Run failing tests: `node_modules/.bin/vitest run src/contexts/review/infrastructure/repositories/reply.repository.test.ts src/contexts/property/infrastructure/repositories/property.repository.test.ts`
6. Expect: all 11 tests pass

**Note:** If no migration file exists, generate one via `npx drizzle-kit generate` and then apply it.

---

## Batch 7 — P1/P2: Documentation Fixes

### Task 30: Update ADR statuses (0002, 0003, 0004)

**Files:**
- `docs/adr/0002-section-based-navigation.md`
- `docs/adr/0003-review-bounded-context.md`
- `docs/adr/0004-inbox-bounded-context.md`

**Steps:**
1. In each ADR, change status line from `Proposed` → `Implemented`
2. Add implementation date: `Implementation date: 2026-05` (or check git log for actual dates)

### Task 31: Fix root CONTEXT.md

**Files:**
- `CONTEXT.md`

**Steps:**
1. Change "Six bounded contexts" → "Eleven bounded contexts"
2. Add Staff row to bounded contexts table: `Staff | Staff assignments to properties | StaffAssignment | Standard`
3. Add ADR 0005 row to Architecture Decisions table

### Task 32: Update plan.md phase statuses

**Files:**
- `docs/plan/plan.md`

**Steps:**
1. Phase 13 (Metrics): change status from "Next up" → "In progress" (or "Substantially complete")
2. Phase 14 (Dashboard): change status from "Pending" → "In progress"

### Task 33: Fix CONTEXT.md files (components, shared, routes)

**Files:**
- `src/components/CONTEXT.md` — add `integration/` and `settings/` to folder structure
- `src/shared/CONTEXT.md` — remove `rate-limit/`, add 10 missing testing fakes, add `slug` to domain types
- `src/routes/CONTEXT.md` — add missing routes (inbox, register, reset-password, import routes)

### Task 34: Fix src/contexts/CONTEXT.md

**Files:**
- `src/contexts/CONTEXT.md`

**Steps:**
1. Add note that metric context has no `server/` layer by design (event-driven)
2. Verify thickness descriptions match reality

---

## Batch 8 — P3: Nice-to-Have (defer if low ROI)

### Task 35: Add DashboardError type
- Create: `src/contexts/dashboard/domain/errors.ts`
- Follow inbox/domain/errors.ts pattern

### Task 36: Add missing public-api barrels
- Create: `src/contexts/guest/application/public-api.ts`
- Create: `src/contexts/identity/application/public-api.ts`
- Create: `src/contexts/metric/application/public-api.ts`
- Create: `src/contexts/team/application/public-api.ts`

### Task 37: Fix test utility unbrand() usage
- Update `src/shared/testing/in-memory-*.ts` files to use `unbrand()` instead of `as string`

### Task 38: Consider ADRs for Staff and Dashboard
- `docs/adr/0006-staff-bounded-context.md`
- `docs/adr/0007-dashboard-read-only-aggregation.md`

---

## Execution Order

| Batch | Tasks | Parallel? | Est. Time |
|-------|-------|-----------|-----------|
| 1 | 1–5 (P1 fixes) | Sequential (shared files) | 15 min |
| 2 | 6–20 (trace wrapping) | 5 groups × 3 parallel | 20 min |
| 3 | 21–24 (unbrand) | All 4 parallel | 5 min |
| 4 | 25–26 (catch logging) | Both parallel | 5 min |
| 5 | 27–28 (imports) | Both parallel | 5 min |
| 6 | 29 (schema migration) | Sequential | 5 min |
| 7 | 30–34 (docs) | All 5 parallel | 10 min |
| 8 | 35–38 (P3) | All parallel | 10 min |
| **Final verify** | `tsc --noEmit` + full test suite | — | 2 min |

**Total: ~38 tasks across 8 batches. Estimated 75 minutes with parallel execution.**
