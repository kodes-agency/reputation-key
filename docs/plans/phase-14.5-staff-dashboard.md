# Phase 14.5 — Staff Dashboard Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Staff members get a personalized dashboard with KPIs, goals, and recent activity for their assigned portals. Managers assign staff to specific portals via multi-select in People page.

**Architecture:** No new bounded context. Server functions in existing contexts (dashboard, goal, staff). Staff home is a route-level view composition. Assignment editing uses diff-on-save pattern.

**Tech Stack:** TanStack Start server functions, Drizzle ORM, React components, Vitest

---

## Task 1: Add portal data to staff assignment server function

**Objective:** `listStaffAssignments` returns `portalId` so the UI can show portal count per user.

**Files:**

- Modify: `src/contexts/staff/application/use-cases/list-staff-assignments.ts`
- Test: `src/contexts/staff/application/use-cases/list-staff-assignments.test.ts`

**Step 1: Check if the use case already returns portalId**

The `StaffAssignment` domain type already has `portalId: PortalId | null`. The `listStaffAssignments` use case returns `StaffAssignment[]`. So portalId is already in the data — we just need to verify it's passed through to the UI.

**TDD:** Skip — the domain type already has `portalId`. Verify by checking the server function output includes it.

**Step 2: Verify server function returns portalId**

Run: `grep -n 'portalId' src/contexts/staff/application/use-cases/list-staff-assignments.ts`

Expected: `portalId` is in the returned type since it's part of `StaffAssignment`.

**Step 3: Update `AssignmentLike` type to include `portalId`**

Modify: `src/lib/lookups.ts` — add `portalId: string | null` to `AssignmentLike` interface.

**Step 4: Update people route loader to include portalId in assignments**

Verify: `src/routes/_authenticated/properties/$propertyId/people.tsx` — check that assignments returned from `listStaffAssignments` include `portalId` in their shape.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(staff): include portalId in assignment data flow"
```

---

## Task 2: Add `getAssignedPortals` use case to staff context

**Objective:** New use case resolves the list of portal IDs a staff member is assigned to within a property. This is the foundation for all staff-facing data scoping.

**Files:**

- Create: `src/contexts/staff/application/use-cases/get-assigned-portals.ts`
- Create: `src/contexts/staff/application/use-cases/get-assigned-portals.test.ts`
- Modify: `src/contexts/staff/application/ports/staff-assignment.repository.ts`
- Modify: `src/contexts/staff/infrastructure/repositories/staff-assignment.repository.ts`
- Modify: `src/contexts/staff/build.ts`

**Step 1: Write failing test**

```typescript
// get-assigned-portals.test.ts
import { describe, it, expect } from 'vitest'
import { getAssignedPortals } from './get-assigned-portals'
import type { StaffAssignmentRepository } from '../ports/staff-assignment.repository'
import type { OrganizationId, UserId, PropertyId, PortalId } from '#/shared/domain/ids'

describe('getAssignedPortals', () => {
  it('returns unique portalIds from user assignments in a property', async () => {
    const assignments = [
      { portalId: 'p1' as PortalId },
      { portalId: 'p2' as PortalId },
      { portalId: 'p1' as PortalId }, // duplicate
    ]
    const mockRepo: StaffAssignmentRepository = {
      listByUserAndProperty: async () => assignments as any,
    } as any

    const result = await getAssignedPortals({ assignmentRepo: mockRepo })({
      orgId: 'org1' as OrganizationId,
      userId: 'u1' as UserId,
      propertyId: 'prop1' as PropertyId,
    })

    expect(result).toEqual(['p1', 'p2'])
  })

  it('filters out null portalIds', async () => {
    const assignments = [{ portalId: 'p1' as PortalId }, { portalId: null }]
    const mockRepo: StaffAssignmentRepository = {
      listByUserAndProperty: async () => assignments as any,
    } as any

    const result = await getAssignedPortals({ assignmentRepo: mockRepo })({
      orgId: 'org1' as OrganizationId,
      userId: 'u1' as UserId,
      propertyId: 'prop1' as PropertyId,
    })

    expect(result).toEqual(['p1'])
  })

  it('returns empty array when no assignments', async () => {
    const mockRepo: StaffAssignmentRepository = {
      listByUserAndProperty: async () => [],
    } as any

    const result = await getAssignedPortals({ assignmentRepo: mockRepo })({
      orgId: 'org1' as OrganizationId,
      userId: 'u1' as UserId,
      propertyId: 'prop1' as PropertyId,
    })

    expect(result).toEqual([])
  })
})
```

**Step 2: Run test to verify failure**

Run: `npx vitest run src/contexts/staff/application/use-cases/get-assigned-portals.test.ts`
Expected: FAIL — module not found

**Step 3: Add `listByUserAndProperty` to repository port**

Add to `StaffAssignmentRepository`:

```typescript
listByUserAndProperty: (orgId: OrganizationId, userId: UserId, propertyId: PropertyId) =>
  Promise<ReadonlyArray<StaffAssignment>>
```

**Step 4: Implement `listByUserAndProperty` in Drizzle repo**

**Step 5: Implement `getAssignedPortals` use case**

```typescript
// get-assigned-portals.ts
import type { StaffAssignmentRepository } from '../ports/staff-assignment.repository'
import type { OrganizationId, UserId, PropertyId, PortalId } from '#/shared/domain/ids'

export type GetAssignedPortalsInput = Readonly<{
  orgId: OrganizationId
  userId: UserId
  propertyId: PropertyId
}>

export type GetAssignedPortalsDeps = Readonly<{
  assignmentRepo: StaffAssignmentRepository
}>

export const getAssignedPortals =
  (deps: GetAssignedPortalsDeps) =>
  async (input: GetAssignedPortalsInput): Promise<ReadonlyArray<PortalId>> => {
    const assignments = await deps.assignmentRepo.listByUserAndProperty(
      input.orgId,
      input.userId,
      input.propertyId,
    )
    const uniquePortalIds = [
      ...new Set(
        assignments.map((a) => a.portalId).filter((id): id is PortalId => id !== null),
      ),
    ]
    return uniquePortalIds
  }
```

**Step 6: Wire into staff build.ts**

**Step 7: Run tests**

Run: `npx vitest run src/contexts/staff/application/use-cases/get-assigned-portals.test.ts`
Expected: PASS

**Step 8: Commit**

```bash
git add -A && git commit -m "feat(staff): add getAssignedPortals use case"
```

---

## Task 3: Add `getStaffDashboard` server function in dashboard context

**Objective:** New server function that resolves staff's assigned portals, then calls existing dashboard queries scoped to those portals.

**Files:**

- Create: `src/contexts/dashboard/server/staff-dashboard.ts`
- Modify: `src/contexts/dashboard/build.ts` (expose new use case)

**Step 1: Create `getStaffDashboardData` use case**

This use case:

1. Takes `{ orgId, userId, propertyId, timeRange }`
2. Calls `getAssignedPortals` to resolve the staff's portals
3. If no portals → returns empty dashboard
4. Calls existing dashboard repo methods with portal filter (aggregate across assigned portals)

The key insight: the dashboard repo's `getKPIs` already accepts `portalId` as an optional filter. For staff, we need a new method or adapt existing queries to accept `portalIds: PortalId[]` for multi-portal aggregation.

**Step 2: Add `getKPIsForPortals` to dashboard repo port**

```typescript
getKPIsForPortals: (input: {
  organizationId: OrganizationId
  propertyId: PropertyId
  portalIds: ReadonlyArray<PortalId>
  startDate: Date
  endDate: Date
  priorStartDate: Date
  priorEndDate: Date
}) => Promise<KPIs>
```

**Step 3: Implement in dashboard repository (SQL WHERE portal_id IN (...))**

**Step 4: Create `getStaffDashboardData` use case**

**Step 5: Create `getStaffDashboardFn` server function**

Pattern matches existing `getDashboardDataFn` but:

- Takes `propertyId` + `timeRange` from input
- Resolves userId from auth context
- Calls `getAssignedPortals` → `getStaffDashboardData`

**Step 6: Wire into dashboard build.ts**

**Step 7: Commit**

```bash
git add -A && git commit -m "feat(dashboard): add staff dashboard server function"
```

---

## Task 4: Update staff sidebar with property picker

**Objective:** Staff sidebar gains a property picker that shares state with the manager picker. Auto-hidden when staff has one property.

**Files:**

- Modify: `src/components/layout/staff-sidebar.tsx`
- Create: `src/components/layout/staff-property-switcher.tsx`
- Modify: `src/routes/_authenticated.tsx`

**Step 1: Create `StaffPropertySwitcher` component**

Reuses the same pattern as `ManagerPropertySwitcher` but navigates to `/home` instead of `/properties/$propertyId`.

**Step 2: Add `usePropertyId` hook to staff sidebar**

The `usePropertyId` hook already exists in `src/components/hooks/use-property-id.ts`. Check if it works for staff routes or needs adaptation.

**Step 3: Update `_authenticated.tsx`**

Pass `properties` to `StaffSidebar`. Currently the staff sidebar only gets organizations — needs properties too.

**Step 4: Update `StaffSidebar` component**

Add `StaffPropertySwitcher` in `SidebarHeader`, conditionally rendered when `properties.length > 1`.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(staff): add property picker to staff sidebar"
```

---

## Task 5: Wire `/home` route to staff dashboard data

**Objective:** Replace the stub `/home` with real data — KPI strip, goal summary, recent activity.

**Files:**

- Modify: `src/routes/_authenticated/home.tsx`
- Create: `src/components/features/staff/staff-home-kpis.tsx`
- Create: `src/components/features/staff/staff-goal-summary.tsx`
- Create: `src/components/features/staff/staff-recent-activity.tsx`

**Step 1: Update `/home` loader**

Replace the stub `listStaffGoals` call with:

```typescript
loader: async () => {
  const { kpis } = await getStaffDashboardFn({ data: { propertyId, timeRange: '30d' } })
  const { goals } = await listStaffGoals({ data: { propertyId } })
  const { reviews } = await getStaffRecentActivity({ data: { propertyId } })
  return { kpis, goals, reviews }
}
```

**Step 2: Create KPI strip component**

Reuses `KpiCard` pattern from manager dashboard but with staff-scoped data.

**Step 3: Create goal summary component**

Shows top 3 goals with mini progress bars. "View all goals" link to `/progress`.

**Step 4: Create recent activity component**

Last 5 reviews/feedback for assigned portals.

**Step 5: Create empty state components**

Two variants: "no portals assigned" and "no properties at all".

**Step 6: Commit**

```bash
git add -A && git commit -m "feat(staff): wire /home to staff dashboard data"
```

---

## Task 6: Wire `listStaffGoals` server function

**Objective:** Replace the stub in `listStaffGoals` with real goal resolution for staff's assigned portals.

**Files:**

- Modify: `src/contexts/goal/server/staff-goals.ts`

**Step 1: Implement the server function**

```typescript
// 1. Resolve userId from auth context
// 2. Resolve assigned portals via getAssignedPortals
// 3. If no portals → return empty
// 4. Query goals where portalId IN (assigned portals) OR groupId IN (groups containing assigned portals)
// 5. Include goal progress
```

**Step 2: Add `listGoalsForPortals` to goal repository port**

**Step 3: Implement `listGoalsForPortals` in goal repository**

**Step 4: Write test**

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(goal): wire listStaffGoals with portal resolution"
```

---

## Task 7: Build `/progress` route — full goal detail

**Objective:** Staff progress page shows all active/completed goals with progress bars, filters, detail.

**Files:**

- Modify: `src/routes/_authenticated/progress.tsx`
- Create: `src/components/features/staff/staff-goal-list.tsx`
- Reuse: `src/components/features/property/goals/goal-progress-bar.tsx` (if exists)

**Step 1: Update loader**

Load all staff goals (not just top 3 like `/home`).

**Step 2: Create goal list component**

Full list with progress bars, filters (by portal, by metric, by status).

**Step 3: Implement**

**Step 4: Commit**

```bash
git add -A && git commit -m "feat(staff): implement /progress route with full goal list"
```

---

## Task 8: People page — add portal multi-select to assign form

**Objective:** "Assign Staff" form gains a portal multi-select. One row per (user, portal) on submit.

**Files:**

- Modify: `src/components/features/staff/assign-staff-form.tsx`
- Create: `src/components/features/staff/portal-selector.tsx`
- Modify: `src/routes/_authenticated/properties/$propertyId/people.tsx` (load portals)

**Step 1: Add portal loading to people route loader**

Call `listPortals` to get available portals for the property.

**Step 2: Create `PortalSelector` component**

Multi-select combobox with "Select all" toggle. Shows portal names.

**Step 3: Update `AssignStaffForm`**

Add `PortalSelector` field. On submit, create N rows (one per selected portal per user).

**Step 4: Commit**

```bash
git add -A && git commit -m "feat(staff): add portal multi-select to assign form"
```

---

## Task 9: People page — staff tab redesign (user-level rows + edit modal)

**Objective:** Staff tab shows one row per user with portal count badge. Edit modal for portal management with diff-on-save.

**Files:**

- Modify: `src/components/features/property/people/staff-tab.tsx`
- Modify: `src/components/features/staff/staff-assignment-list.tsx`
- Create: `src/components/features/staff/edit-staff-portals-modal.tsx`
- Create: `src/contexts/staff/server/bulk-update-portals.ts`

**Step 1: Create `editStaffPortals` server function**

Accepts `{ userId, propertyId, portalIds: string[] }`. Diffs against current assignments — creates new rows, soft-deletes removed rows. Team inherited from existing assignment (or null).

**Step 2: Create `EditStaffPortalsModal` component**

Shows `PortalSelector` pre-filled with current assignments. On save, calls `editStaffPortals`.

**Step 3: Rewrite `StaffAssignmentList`**

Group assignments by userId. One row per user showing: name, email, team badge ("Multiple" if mixed), portal count badge ("3 portals"), Edit button, Unassign button.

**Step 4: Update `StaffTab` to pass grouped data**

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(staff): user-level rows in staff tab with edit modal"
```

---

## Task 10: Add portal filter to staff home

**Objective:** Dropdown on `/home` to scope KPIs to a single assigned portal.

**Files:**

- Modify: `src/routes/_authenticated/home.tsx`
- Modify: `src/components/features/staff/staff-home-kpis.tsx`

**Step 1: Add portal selector dropdown**

Fetches assigned portals. "All portals" (default) + one option per portal.

**Step 2: Re-fetch dashboard data when portal changes**

Use `useNavigate` with search params to trigger loader re-fetch.

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(staff): add portal filter to staff home"
```

---

## Task 11: Add `getStaffRecentActivity` server function

**Objective:** Last 5 reviews/feedback for staff's assigned portals.

**Files:**

- Create: `src/contexts/review/server/staff-recent-activity.ts` (or in dashboard context)

**Step 1: Create server function**

Resolves assigned portals → queries recent reviews for those portals → returns simplified shape (rating, snippet, date, portal name).

**Step 2: Commit**

```bash
git add -A && git commit -m "feat(staff): add staff recent activity server function"
```

---

## Task 12: Empty states and edge cases

**Objective:** Handle all empty states correctly.

**Files:**

- Modify: `src/routes/_authenticated/home.tsx`
- Modify: `src/routes/_authenticated/progress.tsx`
- Create: `src/components/features/staff/staff-empty-state.tsx`

**Step 1: Create `StaffEmptyState` component**

Two variants: "no portals" and "no properties".

**Step 2: Wire into routes**

Check if staff has assignments → show empty state or data.

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(staff): add empty states for no-assignment scenarios"
```

---

## Task 13: Full typecheck + test run

**Objective:** Verify everything compiles and passes.

**Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: 0 errors

**Step 2: Run tests**

Run: `npx vitest run`
Expected: All pass (integration test timeouts are OK — no DB)

**Step 3: Fix any issues**

**Step 4: Commit**

```bash
git add -A && git commit -m "chore: fix typecheck and test issues from Phase 14.5"
```

---

## Execution Notes

- **Task order matters** — Tasks 1-3 build the backend foundation, Tasks 4-7 build the staff routes, Tasks 8-9 build the People page UI, Tasks 10-12 polish.
- **Tasks 8-9 (People page) can run in parallel with Tasks 4-7 (staff routes)** — they touch different files.
- **Task 2 (getAssignedPortals) is the critical path** — everything depends on it.
