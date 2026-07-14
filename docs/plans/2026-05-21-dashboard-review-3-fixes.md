# Dashboard Review #3 Fixes — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Fix 3 MAJOR + 5 MINOR issues from review #3 (boundary overlap, type safety, dead code, UI text).

**Architecture:** Targeted patches across 5 files. No new files. No TDD needed — all are refactors/fixes with existing tests as regression guards.

**Tech Stack:** TypeScript, Vitest, React

---

### Task 1: Fix prior period boundary overlap (M1)

**Objective:** Prevent reviews at the exact boundary timestamp from being counted in both current and prior periods.

**TDD:** Skip — logic fix, existing tests verify no regression.

**Files:**

- Modify: `src/contexts/dashboard/application/use-cases/get-dashboard-data.ts:22-28`

**Step 1:** Change `priorEndDate` to 1ms before `startDate`:

```typescript
function priorPeriod(
  start: Date,
  end: Date,
): { priorStartDate: Date; priorEndDate: Date } {
  const duration = end.getTime() - start.getTime()
  return {
    priorStartDate: new Date(start.getTime() - duration),
    priorEndDate: new Date(start.getTime() - 1), // exclusive boundary
  }
}
```

**Step 2:** Run tests: `node_modules/.bin/vitest run src/contexts/dashboard/ 2>&1 | tail -5`
Expected: 17 passed

**Step 3:** Commit: `git commit -m "fix(dashboard): exclude boundary timestamp from prior period"`

---

### Task 2: Type `timeRangeToDates` param as `TimeRangePreset` (M2 + m1)

**Objective:** Replace `string` with the exported `TimeRangePreset` type; use the previously-unused export.

**TDD:** Skip — type refinement, no behavior change.

**Files:**

- Modify: `src/contexts/dashboard/server/dashboard.ts:15`
- Modify: `src/contexts/dashboard/application/dto/dashboard.dto.ts` (no change needed, already exported)

**Step 1:** Add import and type the parameter:

```typescript
import { getDashboardDataDto, type TimeRangePreset } from '../application/dto/dashboard.dto'
// ...
function timeRangeToDates(preset: TimeRangePreset) {
```

**Step 2:** Run tests: `node_modules/.bin/vitest run src/contexts/dashboard/ 2>&1 | tail -5`
Expected: 17 passed

**Step 3:** Commit: `git commit -m "fix(dashboard): type timeRangeToDates param as TimeRangePreset"`

---

### Task 3: Remove `dashboardRepo` from build API (M3)

**Objective:** Remove unused public API surface from `DashboardContextApi`.

**TDD:** Skip — removing dead export.

**Files:**

- Modify: `src/contexts/dashboard/build.ts:14-16,28`

**Step 1:** Remove `dashboardRepo` from type and return:

```typescript
export type DashboardContextApi = Readonly<{
  getDashboardData: ReturnType<typeof getDashboardData>
}>()

export const buildDashboardContext = (input: DashboardContextBuildInput): DashboardContextApi => {
  const dashboardRepo = createDashboardRepository(input.db)

  const getDashboard = getDashboardData({
    repo: dashboardRepo,
  })

  return {
    getDashboardData: getDashboard,
  }
}
```

Also remove the unused `DashboardRepository` type import.

**Step 2:** Run typecheck: `node_modules/.bin/tsc --noEmit 2>&1 | head -5`
Expected: no errors

**Step 3:** Commit: `git commit -m "refactor(dashboard): remove unused dashboardRepo from build API"`

---

### Task 4: Remove redundant trend guard in KPICard (m2)

**Objective:** Remove dead re-check — backend already returns `null` when both values are 0.

**TDD:** Skip — dead code removal.

**Files:**

- Modify: `src/routes/_authenticated/properties/$propertyId/index.tsx:74`

**Step 1:** Replace:

```typescript
const trendPct = kpi.value === 0 && kpi.priorValue === 0 ? null : kpi.trend
```

With:

```typescript
const trendPct = kpi.trend
```

**Step 2:** Run typecheck: `node_modules/.bin/tsc --noEmit 2>&1 | head -5`
Expected: no errors

**Step 3:** Commit: `git commit -m "refactor(dashboard): remove redundant trend guard in KPICard"`

---

### Task 5: Fix misleading empty-state text (m3)

**Objective:** Change "No reviews in this period" to "No reviews yet" since `getRecentReviews` is not period-scoped.

**TDD:** Skip — text fix.

**Files:**

- Modify: `src/routes/_authenticated/properties/$propertyId/index.tsx:213`

**Step 1:** Replace `No reviews in this period.` with `No reviews yet.`

**Step 2:** Commit: `git commit -m "fix(dashboard): correct empty-state text for recent reviews"`

---

### Task 6: Remove dead `ratingDistribution.length > 0` guard (m4)

**Objective:** `getRatingDistribution` always returns 5 buckets — the guard is always true.

**TDD:** Skip — dead code removal.

**Files:**

- Modify: `src/routes/_authenticated/properties/$propertyId/index.tsx:149`

**Step 1:** Replace `{ratingDistribution.length > 0 && (` with `{(`

**Step 2:** Commit: `git commit -m "refactor(dashboard): remove always-true rating distribution guard"`

---

### Task 7: Fix ReviewVolumePoint.date comment (m5)

**Objective:** Remove misleading "YYYY-WNN for weekly" — implementation is always daily.

**TDD:** Skip — comment fix.

**Files:**

- Modify: `src/contexts/dashboard/domain/types.ts:39`

**Step 1:** Replace:

```typescript
date: string // YYYY-MM-DD or YYYY-WNN for weekly
```

With:

```typescript
date: string // YYYY-MM-DD
```

**Step 2:** Commit: `git commit -m "docs(dashboard): remove misleading weekly date format comment"`

---

### Final verification

```bash
node_modules/.bin/tsc --noEmit 2>&1 | head -5
node_modules/.bin/vitest run src/contexts/dashboard/ 2>&1 | tail -5
```

Expected: 0 type errors, 17 tests passing.
