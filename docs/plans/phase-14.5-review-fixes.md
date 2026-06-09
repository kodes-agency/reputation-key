# Phase 14.5 Review Fixes — Implementation Plan

Generated from Round 1 code review. 11 high-priority issues across architecture, documentation, and testing.

---

## Fix 1: Remove `includePropertyScoped` from staff goals query

**Files:** `src/contexts/goal/server/staff-goals.ts`, `src/contexts/goal/application/ports/goal.repository.ts`, `src/contexts/goal/infrastructure/repositories/goal.repository.ts`

Staff must NOT see property-wide goals. Remove the `includePropertyScoped` flag entirely. The repo method `listByPortalAndGroupIds` should only query portal-scoped and portal-group-scoped goals.

## Fix 2: Add `update-staff-portals.test.ts`

**Files:** Create `src/contexts/staff/application/use-cases/update-staff-portals.test.ts`

Test cases:

- Adds new portal assignments (diff: 3 new)
- Removes old portal assignments (diff: 2 removed)
- Mixed add + remove (diff: 1 add, 1 remove)
- No changes → no ops
- Emits `staff.assigned` for adds, `staff.unassigned` for removes
- Self-assignment check passes (different actingUserId)
- correlationId groups all events from one operation

## Fix 3: Extract portal lookups to portal public-api

**Files:** `src/contexts/staff/server/staff-portals.ts`, `src/contexts/staff/server/staff-assignments.ts`, `src/contexts/goal/server/staff-goals.ts`, `src/contexts/portal/application/public-api.ts`, `src/contexts/review/server/staff-recent-activity.ts`

Add to portal public-api:

- `findById(orgId, portalId): Promise<PortalName | null>` — already exists as `getPortalName`
- `listByProperty(orgId, propertyId): Promise<PortalSummary[]>` — add new method
- `findGroupIdsByPortalIds(orgId, portalIds): Promise<string[]>` — add new method

Server functions call through public-api instead of `container.portalRepo`.

## Fix 4: Export types from public-api, not server/

**Files:**

- `src/contexts/staff/application/public-api.ts` — add `StaffPortalEntry`
- `src/contexts/goal/application/public-api.ts` — add `StaffGoalEntry`
- `src/contexts/review/application/public-api.ts` — add `StaffRecentReview`
- Update imports in: `home.tsx`, `progress.tsx`, `staff-portal-filter.tsx`, `staff-recent-activity.tsx`, `staff-goal-list.tsx`, `staff-goal-summary.tsx`

Move type definitions from server functions to public-api. Components import from public-api.

## Fix 5: Update CONTEXT.md files

**Files:** `src/contexts/staff/CONTEXT.md`, `src/contexts/dashboard/CONTEXT.md`, `src/contexts/goal/CONTEXT.md`

Staff CONTEXT.md:

- Add `getAssignedPortals`, `updateStaffPortals` to use cases table
- Add `staff-portals.ts` to server functions table
- Add `listByUserAndProperty` to ports
- Update architecture layers tree
- Remove TODO from bounded context description

Dashboard CONTEXT.md:

- Add `getStaffDashboardData` to use cases table
- Add `getStaffDashboardDataFn` to server functions table
- Add `StaffPortalResolver` to facade ports
- Update architecture layers tree
- Remove deprecated "Dependencies" sections (per standards §4.3)

Goal CONTEXT.md:

- Change `listStaffGoals` from "(stub)" to fully wired
- Remove "Flagged ambiguities" section (per standards §4.3)
- Remove "Intentional deviations" section (per standards §4.3)

## Fix 6: Fix `updateStaffPortals` use case types and dependencies

**File:** `src/contexts/staff/application/use-cases/update-staff-portals.ts`

- Export `UpdateStaffPortalsInput` with branded types (UserId, PropertyId, PortalId[])
- Export `UpdateStaffPortalsDeps`
- Export `UpdateStaffPortals` return type
- Replace `import { randomUUID } from 'crypto'` with injected `idGen` dependency
- Add `correlationId` to event emissions

## Fix 7: Fix `getAssignedPortals` type exports

**File:** `src/contexts/staff/application/use-cases/get-assigned-portals.ts`

- Export `GetAssignedPortalsInput` type (currently inlined)
- Remove `as string` type assertions on branded PortalId

## Fix 8: Fix dashboard `domain/types.ts` layer violation

**File:** `src/contexts/dashboard/domain/types.ts`

- Move `PortalRatingTrendPoint` to domain/types.ts itself (it's a domain value)
- OR move the import to application layer and re-export from domain
- Remove eslint-disable comment for the layer violation

## Fix 9: Fix server function imports from `domain/errors`

**Files:** `src/contexts/staff/server/staff-assignments.ts`, `src/contexts/dashboard/server/staff-dashboard.ts`

- Re-export error types from `application/public-api.ts`
- Server functions import from public-api instead of domain

## Fix 10: Fix `StaffPortalResolver` port naming

**File:** `src/contexts/dashboard/application/ports/staff-portal-resolver.port.ts`

- Rename to `StaffPortalResolverPort` for consistency with `MetricStatsPort`, `ReviewStatsPort`, etc.
- Update all references: `build.ts`, `composition.ts`

## Fix 11: Expose `getAssignedPortals` via staff public API

**Files:** `src/contexts/staff/application/public-api.ts`, `src/contexts/staff/build.ts`

Add `getAssignedPortals` to `StaffPublicApi` interface and expose via `publicApi` in build return.
