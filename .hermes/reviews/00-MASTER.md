# Code Review: Phase 15 Portal Groups Refactor

**Verdict: FIX REQUIRED** (3 BLOCKER, 3 MAJOR, 3 MINOR, 2 NIT)
**Test Suite:** 177 files, 1684 tests — all green ✓

---

## 🔴 BLOCKER (P0)

### P0-1: Zero tests for new portal-group CRUD (4 use cases + domain + repo + server + event handlers)

New files without ANY test coverage:

- `src/contexts/portal/application/use-cases/create-portal-group.ts` — no test
- `src/contexts/portal/application/use-cases/list-portal-groups.ts` — no test
- `src/contexts/portal/application/use-cases/update-portal-group.ts` — no test
- `src/contexts/portal/application/use-cases/delete-portal-group.ts` — no test
- `src/contexts/portal/domain/portal-group-constructors.ts` — no `portal-group-constructors.test.ts`
- `src/contexts/portal/infrastructure/repositories/portal-group.repository.ts` — no integration test
- `src/contexts/portal/infrastructure/mappers/portal-group.mapper.ts` — no mapper test
- `src/contexts/portal/server/portal-groups.ts` — no server test
- `src/contexts/goal/infrastructure/event-handlers/on-group-deleted.ts` — no handler test

Violates CONTEXT.md: "Domain: 100% coverage, test-first" and "Every use case tested for happy + error paths."
**Fix:** Add tests for all new code. Minimum: domain constructors test, 4 use case tests (happy + error), mapper test, on-group-deleted handler test.

### P0-2: `metric.schema.ts:42` — `groupId` column has no FK reference

```typescript
// Line 42: no .references() — orphaned groupIds allowed
groupId: uuid('group_id'),
```

Compare with `portalId` on line 41: `.references(() => portals.id, { onDelete: 'cascade' })`.
**Fix:** Add `.references(() => portalGroups.id, { onDelete: 'set null' })` — or `cascade` depending on desired behavior when a group is deleted.

### P0-3: `portal-group.schema.ts:20` — `deletedAt` column is dead weight

Schema includes `deletedAt: deletedAtColumn()` but:

- Domain type `PortalGroup` has no `deletedAt` field
- Mapper `portalGroupFromRow` doesn't map `deletedAt`
- Repo `delete()` does hard-delete via `db.delete()`
- No soft-delete logic anywhere

**Fix:** Remove `deletedAtColumn()` from the schema. If soft-delete is planned for later, add it holistically (domain + mapper + repo + use case) at that time.

---

## ⚠️ MAJOR (P1)

### P1-1: Portal group server functions missing `clearTenantCache()`

`src/contexts/portal/server/portal-groups.ts` — All 4 functions (create, update, delete, list) omit the required `clearTenantCache()` call. Every other server function calls it. Pattern documented in `src/contexts/CONTEXT.md` line 97.

**Fix:** Add `import { clearTenantCache } from '#/shared/auth/middleware'` and call `clearTenantCache()` after each handler completes (before return, after try/catch).

### P1-2: `portal-group.repository.ts` — `as string` casts bypassing `unbrand()`

- Line 31: `propertyId as string` — should be `unbrand(propertyId)`
- Line 42: `propertyId as string` — same
- Line 63: `group.organizationId as string` — should be `unbrand(group.organizationId)`
- Line 64: `group.propertyId as string` — should be `unbrand(group.propertyId)`

`unbrand()` is the canonical way to extract raw values from branded types. `as string` casts bypass type safety.

**Fix:** Import `unbrand` and use it consistently.

### P1-3: Portal group server functions don't wrap non-PortalError exceptions

`src/contexts/portal/server/portal-groups.ts` — All 4 handlers do `throw e` for non-PortalError exceptions. Should use `catchUntagged` pattern:

```typescript
} catch (e) {
  if (isPortalError(e))
    throwContextError('PortalError', e, portalErrorStatus(e.code))
  throw catchUntagged(e)  // ← missing
}
```

DB errors, network errors, and unexpected exceptions are re-thrown raw without observability wrapping.

**Fix:** Import `catchUntagged` from `#/shared/auth/server-errors` and wrap non-PortalError throws.

---

## 💡 MINOR (P2)

### P2-1: Delete portal group uses `new Date()` instead of `deps.clock()`

`src/contexts/portal/application/use-cases/delete-portal-group.ts:37` — `occurredAt: new Date()`. Create and update use `deps.clock()`. Delete doesn't accept clock dep.

**Fix:** Add `clock: () => Date` to `DeletePortalGroupDeps`, pass it from `build.ts`, use `deps.clock()` instead of `new Date()`.

### P2-2: Update portal group bypasses `buildPortalGroup` constructor

`src/contexts/portal/application/use-cases/update-portal-group.ts:42-46` — Constructs updated `PortalGroup` inline instead of calling `buildPortalGroup`. The DTO validates the name, but domain constructor is the canonical validation point.

**Fix:** Pass the update through `buildPortalGroup` and use `existing.*` for fields not being changed.

### P2-3: `goal.list` method comment out of date

`src/contexts/goal/application/ports/goal.repository.ts:32` — The `insert` method signature says `Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>` but the file now contains full CRUD — this is a port, not an insert-only concern. (Pre-existing, not new.)

---

## 🔧 NIT (P3)

### P3-1: `computedSource: 'event_increment'` vs `'reconciliation'` hardcoded

`src/contexts/goal/infrastructure/repositories/goal.repository.ts` — `upsertProgress` always uses `computedSource: 'event_increment'` regardless of call path. If reconciliation job also calls this method, the source tag would be wrong. (Pre-existing — verify the reconciliation job uses `incrementProgress` not `upsertProgress`.)

### P3-2: `portal-group.repository.ts` — `throw new Error()` without tagged error

Lines 70, 82 — `throw new Error('PortalGroup insert failed')` and `throw new Error('PortalGroup update failed')`. This is the conventional pattern used in this codebase (other repos do the same for "should never happen" cases). Consistent, but fragile — if Drizzle ever returns empty array on success, this becomes a misleading error. Consider a shared `assertRow` helper.

---

## ✅ Positive

- **Complete dead code removal** — 12 deleted files (on-staff-unassigned, on-team-deleted, get-staff-id-for-session, record-scan-with-ref, resolve-referral-code, referral-code, staff-attribution-flow). All deleted files properly removed.
- **Event handler follows per-item try/catch pattern** — `onGroupDeleted` catches per-goal errors and continues (P0-compliant).
- **Metric event handler uses outer try/catch for initial query** — `onMetricRecorded` wraps `findActiveGoalsByMetric` in try/catch.
- **`findActiveGoalsByMetric` with groupId matching logic** — The OR condition `groupId IS NULL` correctly captures property-scoped + group-scoped goals for readings with groupId set.
- **Repos consistently use `baseWhere` for org isolation** — Portal group repo, goal repo, metric repo all use org-scoped queries.
- **Exactly-one FK validation in `buildGoal`** — Count check on `[portalId, groupId].filter(Boolean).length > 1` is correct.
- **`Number.isFinite` guard on `targetValue`** in `buildGoal` — P0-compliant NaN/Infinity prevention.
- **Test suite clean** — 177 files, 1684 tests, zero regressions.

---

## Files Reviewed

### New files (portal-group CRUD):

- `src/contexts/portal/domain/portal-group-types.ts`
- `src/contexts/portal/domain/portal-group-constructors.ts`
- `src/contexts/portal/domain/portal-group-events.ts`
- `src/contexts/portal/domain/errors.ts`
- `src/contexts/portal/application/dto/portal-group.dto.ts`
- `src/contexts/portal/application/ports/portal-group.repository.ts`
- `src/contexts/portal/application/use-cases/create-portal-group.ts`
- `src/contexts/portal/application/use-cases/list-portal-groups.ts`
- `src/contexts/portal/application/use-cases/update-portal-group.ts`
- `src/contexts/portal/application/use-cases/delete-portal-group.ts`
- `src/contexts/portal/infrastructure/repositories/portal-group.repository.ts`
- `src/contexts/portal/infrastructure/mappers/portal-group.mapper.ts`
- `src/contexts/portal/server/portal-groups.ts`

### Modified files (schema, goal, metric, guest, staff, etc.):

- `src/shared/db/schema/portal-group.schema.ts`
- `src/shared/db/schema/goal.schema.ts`
- `src/shared/db/schema/metric.schema.ts`
- `src/shared/db/schema/guest.schema.ts`
- `src/shared/db/schema/staff-assignment.schema.ts`
- `src/shared/db/schema/business.ts`
- `src/shared/db/schema/team.schema.ts`
- `src/shared/db/schema/portal.schema.ts`
- `src/shared/domain/ids.ts`
- `src/shared/domain/metric-keys.ts`, `.test.ts`
- `src/composition.ts`
- `src/contexts/portal/build.ts`
- `src/contexts/goal/domain/types.ts`, `constructors.ts`, `events.ts`
- `src/contexts/goal/domain/progress-strategy.ts`, `.test.ts`
- `src/contexts/goal/infrastructure/repositories/goal.repository.ts`
- `src/contexts/goal/infrastructure/mappers/goal.mapper.ts`, `.test.ts`
- `src/contexts/goal/infrastructure/event-handlers/on-group-deleted.ts`
- `src/contexts/goal/infrastructure/event-handlers/on-metric-recorded.ts`, `.test.ts`
- `src/contexts/goal/server/goals.ts`, `.test.ts`
- `src/contexts/goal/application/use-cases/*.ts`, `*.test.ts`
- `src/contexts/goal/application/ports/goal.repository.ts`
- `src/contexts/goal/application/dto/goal.dto.ts`
- `src/contexts/metric/domain/types.ts`, `constructors.ts`, `events.ts`
- `src/contexts/metric/application/use-cases/record-metric.ts`, `.test.ts`
- `src/contexts/metric/application/ports/metric.repository.ts`
- `src/contexts/metric/infrastructure/repositories/metric.repository.ts`, `.test.ts`
- `src/contexts/metric/infrastructure/event-handlers/on-*.ts`, `*.test.ts`
- `src/contexts/guest/domain/**` (removed staffId)
- `src/contexts/guest/application/use-cases/*.ts` (removed staff attribution)
- `src/contexts/guest/infrastructure/mappers/**` (removed staffId)
- `src/contexts/guest/server/public.ts`
- `src/contexts/staff/**` (removed referral codes, added portalId)
- `src/contexts/inbox/application/use-cases/*.test.ts` (removed staffId)
- `src/contexts/review/domain/events.ts`
- `src/contexts/property/**` (minor)
- `src/contexts/team/**` (minor)
- `src/components/**` (goal entity picker, form)
- `src/routes/**` (goal creation route)
- `docs/plan/plan.md`, `CONTEXT.md`
