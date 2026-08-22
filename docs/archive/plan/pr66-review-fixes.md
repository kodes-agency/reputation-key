# PR #66 Review Fixes — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Fix all issues found in the PR #66 code review — critical multi-tenant gaps, architecture violations, duplicated code, broken patterns, and UI bugs.

**Architecture:** Hexagonal (ports & adapters). Fixes respect layer boundaries: domain → application → infrastructure → server. Multi-tenant isolation enforced at every data-touching boundary.

**Tech Stack:** TypeScript, TanStack Start, Drizzle ORM, Vitest, Recharts, shadcn/ui

---

## Batch 1 — Critical Data Integrity (sequential, C1–C3)

### Task 1: Add `organizationId` to `upsertProgress` port signature

**Objective:** Close the multi-tenant defense-in-depth gap in the goal repository port.

**Files:**

- Modify: `src/contexts/goal/application/ports/goal.repository.ts:81-89`

**TDD:** Skip — signature-only change, no behavior. All callers updated in Task 2.

**Step 1:** Add `organizationId: OrganizationId` as the first parameter.

```ts
// Before
upsertProgress(
  goalId: GoalId,
  aggregation: AggregationFunction,
  delta: number,
): Promise<{ ... }>

// After
upsertProgress(
  goalId: GoalId,
  organizationId: OrganizationId,
  aggregation: AggregationFunction,
  delta: number,
): Promise<{ ... }>
```

Add the import at the top if `OrganizationId` is not already imported:

```ts
import type { OrganizationId } from '#/shared/domain/ids'
```

**Step 2:** Verify typecheck fails (callers now have wrong arity):

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

Expected: Type errors in `goal.repository.ts` (implementation), `on-metric-recorded.ts`, and test files referencing `upsertProgress`.

**Step 3:** Commit (incomplete, WIP — will be followed by Task 2):

```bash
git add src/contexts/goal/application/ports/goal.repository.ts
```

---

### Task 2: Add `organizationId` guard to `upsertProgress` implementation

**Objective:** Enforce tenant ownership at the SQL level inside the repository.

**Files:**

- Modify: `src/contexts/goal/infrastructure/repositories/goal.repository.ts:340-443`
- Modify: `src/contexts/goal/infrastructure/event-handlers/on-metric-recorded.ts:56`
- Modify: `src/contexts/goal/infrastructure/event-handlers/on-metric-recorded.test.ts:71`
- Modify: `src/contexts/goal/infrastructure/event-handlers/on-portal-deleted.test.ts:90`
- Modify: `src/contexts/goal/infrastructure/event-handlers/on-staff-unassigned.test.ts:99`
- Modify: `src/contexts/goal/infrastructure/event-handlers/on-team-deleted.test.ts:90`
- Modify: `src/contexts/goal/infrastructure/jobs/reconcile-goal-progress.job.test.ts:108`
- Modify: `src/contexts/goal/infrastructure/jobs/spawn-recurring-instances.job.test.ts:116`
- Modify: `src/contexts/goal/application/use-cases/cancel-goal.test.ts:102`
- Modify: `src/contexts/goal/application/use-cases/create-goal.test.ts:99`
- Modify: `src/contexts/goal/application/use-cases/get-goal.test.ts:111`
- Modify: `src/contexts/goal/application/use-cases/list-goals.test.ts:119`
- Modify: `src/contexts/goal/application/use-cases/update-goal.test.ts:101`

**TDD:** Yes — update test fakes first, then implementation.

**Step 1:** Update all test fakes to accept and ignore the new `organizationId` param.

Pattern for each test file's fake:

```ts
// Before
upsertProgress: async (goalId, aggregation, delta) => { ... }
// After
upsertProgress: async (goalId, _orgId, aggregation, delta) => { ... }
```

For stub fakes that return immediately:

```ts
// Before
upsertProgress: async () => ({ currentValue: 0, currentSum: null, currentCount: null })
// After — same, extra param is ignored
upsertProgress: async () => ({ currentValue: 0, currentSum: null, currentCount: null })
```

**Step 2:** Update the `on-metric-recorded.ts` caller at line 56:

```ts
// Before
const result = await goalRepo.upsertProgress(
  goal.id,
  goal.aggregationFunction,
  event.value,
)

// After
const result = await goalRepo.upsertProgress(
  goal.id,
  goal.organizationId,
  goal.aggregationFunction,
  event.value,
)
```

**Step 3:** Update the `on-metric-recorded.test.ts` fake at line 71 to use the 4-param signature:

```ts
upsertProgress: async (goalId, _orgId, aggregation, delta) => {
  // existing fake logic unchanged
}
```

And update any calls to `goalRepo.upsertProgress(` in that test to pass a dummy orgId.

**Step 4:** Update the implementation in `goal.repository.ts:340`:

```ts
// Before
upsertProgress: async (goalId, aggregation, delta) => {
// After
upsertProgress: async (goalId, organizationId, aggregation, delta) => {
```

Add an ownership assertion before each SQL operation (inside `trace`):

```ts
upsertProgress: async (goalId, organizationId, aggregation, delta) => {
  return trace('goal.upsertProgress', async () => {
    // Verify the goal belongs to this organization before upserting
    const [row] = await db
      .select({ organizationId: goals.organizationId })
      .from(goals)
      .where(eq(goals.id, goalId))
      .limit(1)

    if (!row || row.organizationId !== organizationId) {
      throw new Error(`upsertProgress: goal ${goalId} not found or tenant mismatch`)
    }

    // ... rest of aggregation logic unchanged
```

**Step 5:** Run tests:

```bash
pnpm vitest run src/contexts/goal
```

Expected: All pass.

**Step 6:** Typecheck:

```bash
pnpm tsc --noEmit
```

Expected: Clean.

**Step 7:** Commit:

```bash
git add -A
git commit -m "fix(goal): add organizationId guard to upsertProgress for tenant isolation (C1)"
```

---

### Task 3: Generate and verify `goal_progress` unique index migration

**Objective:** Ensure the schema change from `index` to `uniqueIndex` has a valid migration.

**Files:**

- Create: `drizzle/XXXX_goal_progress_goal_uniq.sql` (generated)

**TDD:** Skip — schema/migration, no unit test.

**Step 1:** Check for existing duplicate `goalId` rows:

```bash
# Run against dev database — adapt connection string as needed
psql $DATABASE_URL -c "
  SELECT goal_id, COUNT(*) as cnt
  FROM goal_progress
  GROUP BY goal_id
  HAVING COUNT(*) > 1;
"
```

**Step 2:** If duplicates exist, create a dedup migration first:

```sql
-- Keep the latest row per goal_id
DELETE FROM goal_progress a
USING goal_progress b
WHERE a.goal_id = b.goal_id
  AND a.id < b.id;
```

**Step 3:** Generate the migration:

```bash
pnpm drizzle-kit generate
```

**Step 4:** Inspect the generated SQL — verify it creates `UNIQUE INDEX goal_progress_goal_uniq ON goal_progress (goal_id)`.

**Step 5:** Apply to dev:

```bash
pnpm drizzle-kit push
```

**Step 6:** Commit:

```bash
git add drizzle/
git commit -m "feat(db): add unique index on goal_progress.goal_id (C2)"
```

---

## Batch 2 — Architecture Violations (sequential, W7 + W1 + W2)

### Task 4: Move `PortalRatingTrendPoint` to domain types (W7)

**Objective:** Fix domain→application import violation.

**Files:**

- Modify: `src/contexts/dashboard/domain/types.ts:6,119`
- Modify: `src/contexts/dashboard/application/ports/portal-metrics.port.ts:12-15`
- Modify: `src/contexts/dashboard/infrastructure/adapters/portal-metrics.adapter.ts:9,88`

**TDD:** Skip — pure type move, no behavior change.

**Step 1:** Add `PortalRatingTrendPoint` to `src/contexts/dashboard/domain/types.ts`. Remove the import from line 6 and add the type definition inline (around line 105, near the portal analytics section):

```ts
// Remove line 6:
// import type { PortalRatingTrendPoint } from '../application/ports/portal-metrics.port'

// Add after line 105 (PortalAnalyticsData section):
export type PortalRatingTrendPoint = Readonly<{
  date: string // YYYY-MM-DD
  avgRating: number
}>
```

**Step 2:** In `src/contexts/dashboard/application/ports/portal-metrics.port.ts`, remove the `PortalRatingTrendPoint` type definition (lines 12-15) and import it from domain:

```ts
import type { PortalRatingTrendPoint } from '../../domain/types'
```

Re-export it for backward compatibility:

```ts
export type { PortalRatingTrendPoint }
```

**Step 3:** Update `src/contexts/dashboard/infrastructure/adapters/portal-metrics.adapter.ts` line 9 — no change needed if the port re-exports it. Verify the import path still resolves.

**Step 4:** Verify:

```bash
pnpm tsc --noEmit
```

**Step 5:** Commit:

```bash
git add src/contexts/dashboard/domain/types.ts src/contexts/dashboard/application/ports/portal-metrics.port.ts
git commit -m "fix(dashboard): move PortalRatingTrendPoint to domain types (W7)"
```

---

### Task 5: Extract duplicated code from dashboard server files (W1)

**Objective:** Eliminate byte-for-byte duplication of `makeDashboardError`, `dashboardErrorStatus`, `MS_PER_DAY`, and `timeRangeToDates`.

**Files:**

- Create: `src/contexts/dashboard/server/dashboard-server-utils.ts`
- Modify: `src/contexts/dashboard/server/dashboard.ts`
- Modify: `src/contexts/dashboard/server/portal-analytics.ts`

**TDD:** Skip — pure extraction, no behavior change.

**Step 1:** Create `src/contexts/dashboard/server/dashboard-server-utils.ts`:

```ts
// Dashboard context — shared server utilities
// Error factory, status mapping, time range conversion.

import { match } from 'ts-pattern'
import type { DashboardErrorCode } from '../domain/errors'
import type { TimeRangePreset } from '../application/dto/dashboard.dto'

/** Local error constructor — server must not import domain error constructors. */
export const makeDashboardError = (code: DashboardErrorCode, message: string) => ({
  _tag: 'DashboardError' as const,
  code,
  message,
})

export const dashboardErrorStatus = (code: DashboardErrorCode): number =>
  match(code)
    .with('forbidden', () => 403)
    .with('not_found', () => 404)
    .with('invalid_input', () => 400)
    .exhaustive()

const MS_PER_DAY = 86_400_000

export function timeRangeToDates(preset: TimeRangePreset) {
  const now = new Date()
  if (preset === 'all') {
    return { startDate: new Date(0), endDate: now }
  }
  const days = preset === '7d' ? 7 : preset === '60d' ? 60 : preset === '90d' ? 90 : 30
  return {
    startDate: new Date(now.getTime() - days * MS_PER_DAY),
    endDate: now,
  }
}
```

**Step 2:** In `src/contexts/dashboard/server/dashboard.ts`, replace lines 19-48 with imports:

```ts
import {
  makeDashboardError,
  dashboardErrorStatus,
  timeRangeToDates,
} from './dashboard-server-utils'
```

Remove: `match` import (if only used by `dashboardErrorStatus`), the `makeDashboardError` function, `dashboardErrorStatus`, `MS_PER_DAY`, and `timeRangeToDates`.

**Step 3:** Same treatment for `src/contexts/dashboard/server/portal-analytics.ts`.

**Step 4:** Verify:

```bash
pnpm tsc --noEmit
```

**Step 5:** Commit:

```bash
git add src/contexts/dashboard/server/
git commit -m "refactor(dashboard): extract shared server utils to deduplicate (W1)"
```

---

### Task 6: Replace `PortalAnalyticsTab` manual fetch with route loader data (W2 + W3 + W4 + W5 + W6 + W12)

**Objective:** Move portal analytics fetching from manual `useState`/`useEffect` to the route loader. Fix hydration mismatch, stale closure, missing dep, direct server import, and bypass of TanStack Router search params.

**Files:**

- Modify: `src/routes/_authenticated/properties/$propertyId/portals/$portalId.tsx`
- Modify: `src/components/features/portal/portal-analytics/portal-analytics-tab.tsx`
- Modify: `src/components/features/portal/portal-detail/portal-detail-page.tsx`

**TDD:** Skip — UI pattern change, no domain logic to test.

This is a compound task because the fixes are deeply intertwined — the hydration issue (W3), stale closure (W5), missing dep (W5), direct server import (W12), and URLSearchParams bypass (W6) are all symptoms of the same root cause: the component manages its own data fetching instead of using TanStack Router properly.

**Step 1:** Add `validateSearch` with `tab` and `timeRange` params to the portal detail route file (`src/routes/_authenticated/properties/$propertyId/portals/$portalId.tsx`):

```ts
import { z } from 'zod/v4'
import { getPortalAnalyticsFn } from '#/contexts/dashboard/server/portal-analytics'

const portalDetailSearch = z.object({
  tab: z.enum(['settings', 'links', 'analytics']).default('settings'),
  timeRange: z.enum(['7d', '30d', '60d', '90d', 'all']).default('all'),
})
```

**Step 2:** Add `loaderDeps` and extend the loader to fetch analytics when `tab=analytics`:

```ts
export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/portals/$portalId',
)({
  validateSearch: portalDetailSearch,
  staleTime: 30_000,
  loaderDeps: ({ search }) => ({
    tab: search.tab,
    timeRange: search.timeRange,
  }),
  loader: async ({ params, deps }) => {
    const [{ portal }, { categories, links }] = await Promise.all([
      getPortal({ data: { portalId: params.portalId } }),
      listPortalLinks({ data: { portalId: params.portalId } }),
    ])
    if (!portal) throw notFound()

    // Eagerly load analytics only when on the analytics tab
    const analytics =
      deps.tab === 'analytics'
        ? await getPortalAnalyticsFn({
            data: {
              propertyId: params.propertyId,
              portalId: params.portalId,
              timeRange: deps.timeRange,
            },
          })
        : null

    return {
      portal,
      categories,
      links,
      propertyId: params.propertyId,
      analytics,
    }
  },
  component: PortalDetailRoute,
})
```

**Step 3:** Pass the analytics data and search params to `PortalDetailPage`:

```tsx
function PortalDetailRoute() {
  const { portal, categories, links, propertyId, analytics } = Route.useLoaderData()
  const { tab, timeRange } = Route.useSearch()
  const navigate = Route.useNavigate()
  // ... existing mutation code ...

  return (
    <PageShell>
      <PortalDetailPage
        portal={portal}
        propertyId={propertyId}
        categories={categories}
        links={links}
        updateMutation={mutation}
        organizationName={ctx.activeOrganization?.name ?? 'Your Organization'}
        propertySlug={propertySlug}
        requestUploadUrl={requestUploadUrlFn}
        finalizeUpload={finalizeUploadFn}
        currentTab={tab}
        timeRange={timeRange}
        analyticsData={analytics}
        onTabChange={(value) => navigate({ search: (prev) => ({ ...prev, tab: value }) })}
        onTimeRangeChange={(value) =>
          navigate({ search: (prev) => ({ ...prev, timeRange: value }) })
        }
      />
    </PageShell>
  )
}
```

**Step 4:** Rewrite `portal-detail-page.tsx` to use props instead of `window.location`:

Remove `useRouter`, `useNavigate` imports (if only used for tab state). Replace lines 75-87:

```ts
// Remove:
const currentTab = (() => {
  const params = new URLSearchParams(...)
  ...
})()

// Use prop:
const { currentTab, onTabChange } = props
```

Update the `Tabs` component:

```tsx
<Tabs value={currentTab} onValueChange={onTabChange}>
```

**Step 5:** Rewrite `portal-analytics-tab.tsx` to accept data as props instead of fetching:

```tsx
type Props = Readonly<{
  portalId: string
  propertyId: string
  data: PortalAnalyticsData | null
  loading: boolean
  timeRange: TimeRangePreset
  onTimeRangeChange: (value: TimeRangePreset) => void
}>
```

Remove: `useState` for data/loading/error, `useEffect` for fetch, `useServerFn` import, `localStorage` access, the `analyticsFn` variable. Replace with props.

Keep the chart sub-components (`EngagementFunnelChart`, `RatingDistributionChart`, `RatingTrendChart`, `ChartCard`, `TimeRangePicker`) unchanged — they're fine.

**Step 6:** Verify:

```bash
pnpm tsc --noEmit
```

**Step 7:** Commit:

```bash
git add src/routes/_authenticated/properties/\$propertyId/portals/\$portalId.tsx src/components/features/portal/portal-analytics/portal-analytics-tab.tsx src/components/features/portal/portal-detail/portal-detail-page.tsx
git commit -m "refactor(portal): move analytics fetch to route loader, use TanStack Router search params (W2/W3/W4/W5/W6/W12)"
```

---

## Batch 3 — Error Handling & Observability (sequential, W8 + W10)

### Task 7: Narrow error catch in `listStaffAssignments` to retriable errors only (W10)

**Objective:** Stop swallowing auth failures and programming bugs as empty data.

**Files:**

- Modify: `src/contexts/staff/server/staff-assignments.ts:107-118`

**TDD:** Skip — server function error handling, manual verification.

**Step 1:** Replace the broad catch with a narrowed one:

```ts
} catch (e) {
  if (isStaffError(e))
    throwContextError('StaffError', e, staffErrorStatus(e.code))

  // Only swallow retriable infrastructure errors (connection reset, cold start)
  const msg = e instanceof Error ? e.message : String(e)
  const isRetriable =
    msg.includes('ECONNRESET') ||
    msg.includes('connect ETIMEDOUT') ||
    msg.includes('Connection terminated') ||
    msg.includes('timeout') ||
    msg.includes('Cannot read properties of undefined')

  if (isRetriable) {
    const logger = (await import('#/shared/observability/logger')).getLogger()
    logger.error(
      { error: msg, path: 'staff.listStaffAssignments' },
      'staff.listStaffAssignments — returning empty due to retriable error',
    )
    return { assignments: [] }
  }

  throw e
}
```

**Step 2:** Verify:

```bash
pnpm tsc --noEmit
```

**Step 3:** Commit:

```bash
git add src/contexts/staff/server/staff-assignments.ts
git commit -m "fix(staff): narrow error catch in listStaffAssignments to retriable errors only (W10)"
```

---

### Task 8: Fix `lastMarkedId` ref→state in `useInboxDetail` (W13)

**Objective:** Ref value read at render time is fragile — use proper state.

**Files:**

- Modify: `src/components/inbox/use-inbox-detail.ts:100,108,131`

**TDD:** Skip — React hook refactor, no domain logic.

**Step 1:** Replace `useRef<string | null>` with `useState<string | null>`:

```ts
// Line 100 — replace:
const lastMarkedRef = useRef<string | null>(null)
// With:
const [lastMarkedId, setLastMarkedId] = useState<string | null>(null)
```

**Step 2:** Update the auto-mark-read effect (line 104-112):

```ts
useEffect(() => {
  if (!options?.autoMarkRead || !active || !item) return
  if (lastMarkedId === item.id) return
  if (item.status !== 'new') return

  const timer = setTimeout(() => {
    setLastMarkedId(item.id)
    markReadRef.current({ data: { inboxItemId: item.id, status: 'read' } })
  }, 500)
  return () => clearTimeout(timer)
}, [options?.autoMarkRead, active, item, lastMarkedId])
```

**Step 3:** Update the return object (line 131):

```ts
// Before:
lastMarkedId: lastMarkedRef.current,
// After:
lastMarkedId,
```

**Step 4:** Remove `lastMarkedRef` declaration entirely. Verify no other references.

**Step 5:** Verify:

```bash
pnpm tsc --noEmit
```

**Step 6:** Commit:

```bash
git add src/components/inbox/use-inbox-detail.ts
git commit -m "fix(inbox): replace lastMarkedId ref with state for reliable render (W13)"
```

---

## Batch 4 — UI Quality (parallel: Tasks 9, 10, 11, 12)

### Task 9: Fix `ChartCard` className concatenation — use `cn()` (W9)

**Objective:** Use the project-standard `cn()` utility instead of string concatenation.

**Files:**

- Modify: `src/components/features/portal/portal-analytics/portal-analytics-tab.tsx:164`

**TDD:** Skip — trivial className fix.

**Step 1:** Add import at the top of the file:

```ts
import { cn } from '#/lib/utils'
```

**Step 2:** Replace line 164:

```ts
// Before:
<div className={`rounded-lg border bg-muted/30 p-4 ${className ?? ''}`}>
// After:
<div className={cn('rounded-lg border bg-muted/30 p-4', className)}>
```

**Step 3:** Commit:

```bash
git add src/components/features/portal/portal-analytics/portal-analytics-tab.tsx
git commit -m "fix(portal): use cn() for ChartCard className merging (W9)"
```

---

### Task 10: Fix `fill="#fff"` hardcoded in funnel labels (S2)

**Objective:** Use theme-aware color instead of hardcoded white.

**Files:**

- Modify: `src/components/features/portal/portal-analytics/portal-analytics-tab.tsx:205`

**TDD:** Skip — visual CSS change.

**Step 1:** Replace line 205:

```ts
// Before:
fill = '#fff'
// After:
fill = 'var(--primary-foreground)'
```

If `--primary-foreground` isn't defined in the theme, use `hsl(var(--foreground))` and ensure high contrast with chart fills. Alternatively, keep `#fff` but add a `className="drop-shadow-sm"` for readability.

**Step 2:** Verify visually in dev server.

**Step 3:** Commit:

```bash
git add src/components/features/portal/portal-analytics/portal-analytics-tab.tsx
git commit -m "fix(portal): use theme variable for funnel label fill (S2)"
```

---

### Task 11: Fix `Cell key={index}` to use stable key (S1)

**Objective:** Use `entry.name` as a stable React key instead of array index.

**Files:**

- Modify: `src/components/features/portal/portal-analytics/portal-analytics-tab.tsx:209-211`

**TDD:** Skip — React key fix.

**Step 1:** Replace line 209-211:

```ts
// Before:
{data.map((entry, index) => (
  <Cell key={index} fill={entry.fill} />
))}
// After:
{data.map((entry) => (
  <Cell key={entry.name} fill={entry.fill} />
))}
```

**Step 2:** Commit:

```bash
git add src/components/features/portal/portal-analytics/portal-analytics-tab.tsx
git commit -m "fix(portal): use stable key for funnel Cell elements (S1)"
```

---

### Task 12: Fix `PageShell` docstring to match reality (W11)

**Objective:** Comment says horizontal padding exists — it doesn't.

**Files:**

- Modify: `src/components/layout/page-shell.tsx:10`

**TDD:** Skip — comment fix.

**Step 1:** Replace the JSDoc comment:

```ts
// Before:
/**
 * Uniform page wrapper for all non-dashboard authenticated pages.
 * Provides centered max-width container with consistent vertical spacing.
 * Padding (px-4/py-5 mobile, px-6/py-8 desktop) comes from <main>.
 */

// After:
/**
 * Uniform page wrapper for all non-dashboard authenticated pages.
 * Provides centered max-w-5xl container with consistent vertical spacing.
 * Vertical padding (py-5 mobile, py-8 desktop) comes from <main> in _authenticated.tsx.
 * No horizontal padding — content uses full width within the max-w-5xl constraint.
 */
```

**Step 2:** Commit:

```bash
git add src/components/layout/page-shell.tsx
git commit -m "docs(page-shell): fix inaccurate docstring about padding (W11)"
```

---

### Task 13: Restore `<Link>` in `import-progress.tsx` and fix properties loader staleTime (W9/import)

**Objective:** Restore progressive enhancement (semantic `<a>`, middle-click works). Fix the root cause (stale list after import) at the loader level instead.

**Files:**

- Modify: `src/components/features/integration/import-progress/import-progress.tsx:74-83`
- Modify: `src/routes/_authenticated/properties/index.tsx` (or wherever the properties list loader lives — verify path)

**TDD:** Skip — UI + loader config change.

**Step 1:** In `import-progress.tsx`, replace the imperative button:

```tsx
// Before:
<Button
  onClick={async () => {
    await router.invalidate()
    navigate({ to: '/properties' })
  }}
>
  Go to Properties
</Button>

// After:
<Button asChild>
  <Link to="/properties">Go to Properties</Link>
</Button>
```

Remove unused `useRouter` import if no other usage.

**Step 2:** Find the properties list route (`src/routes/_authenticated/properties/index.tsx` or `_authenticated/properties.tsx`). Check its `staleTime`:

```bash
grep -n 'staleTime' src/routes/_authenticated/properties/index.tsx src/routes/_authenticated/properties.tsx
```

If `staleTime` is high (e.g., `60_000`), reduce it or add `gcTime: 0` so TanStack Router refetches on navigation:

```ts
staleTime: 0,
```

Alternatively, invalidate the properties route after the import job completes — in the import polling logic.

**Step 3:** Verify:

```bash
pnpm tsc --noEmit
```

**Step 4:** Commit:

```bash
git add src/components/features/integration/import-progress/import-progress.tsx
git commit -m "fix(import): restore Link for progressive enhancement, fix properties loader staleTime"
```

---

### Task 14: Add `as TimeRangePreset` validation (W6)

**Objective:** Validate the string from Tabs `onValueChange` instead of unsafe cast.

**Files:**

- Modify: `src/components/features/portal/portal-analytics/portal-analytics-tab.tsx` (if still exists after Task 6 — this task is only needed if Task 6 is NOT done, otherwise the validation is in `validateSearch`)

**Note:** If Task 6 (route loader migration) is completed, this issue is already resolved — `validateSearch` with `z.enum()` handles validation. Skip this task.

**TDD:** Skip — type guard addition.

**Step 1:** If Task 6 was NOT done, add validation:

```ts
import { TIME_RANGE_OPTIONS } from '#/contexts/dashboard/application/dto/dashboard.dto'

const handleTimeRangeChange = (value: string) => {
  const valid = TIME_RANGE_OPTIONS.find((opt) => opt.value === value)
  if (valid) setTimeRange(value as TimeRangePreset)
}
```

**Step 2:** Commit (only if needed):

```bash
git add src/components/features/portal/portal-analytics/portal-analytics-tab.tsx
git commit -m "fix(portal): validate time range value before casting (W6)"
```

---

### Task 15: Add logging to `Promise.allSettled` rejections in property layout (W11/properties)

**Objective:** Log rejected promises so monitoring catches persistent failures.

**Files:**

- Modify: `src/routes/_authenticated/properties/$propertyId.tsx`

**TDD:** Skip — logging addition.

**Step 1:** Find the `Promise.allSettled` block. Add logging for rejected results:

```ts
// After Promise.allSettled:
const staffResult = results[1]
const teamResult = results[2]

if (staffResult.status === 'rejected') {
  const logger = (await import('#/shared/observability/logger')).getLogger()
  logger.warn(
    { err: staffResult.reason, propertyId },
    'Property layout: staff count failed',
  )
}
if (teamResult.status === 'rejected') {
  const logger = (await import('#/shared/observability/logger')).getLogger()
  logger.warn(
    { err: teamResult.reason, propertyId },
    'Property layout: team count failed',
  )
}
```

**Note:** Since this is a route loader (not a React component), the dynamic import is fine. Consider importing the logger statically at the top of the file instead.

**Step 2:** Commit:

```bash
git add src/routes/_authenticated/properties/\$propertyId.tsx
git commit -m "fix(properties): log Promise.allSettled rejections for observability"
```

---

## Batch 5 — Verify Everything (sequential)

### Task 16: Full test suite + typecheck

**Objective:** Confirm all fixes work together, no regressions.

**Step 1:** Typecheck:

```bash
pnpm tsc --noEmit
```

Expected: 0 errors.

**Step 2:** Run all tests:

```bash
pnpm vitest run 2>&1 | tail -20
```

Expected: Same count as before (1735/1737), no new failures.

**Step 3:** Verify no `console.log` or debug artifacts:

```bash
git diff main..HEAD -- . | grep -n "console\.log\|debugger\|FIXME\|HACK"
```

Expected: No output.

**Step 4:** Final commit if any cleanup needed:

```bash
git add -A
git commit -m "chore: cleanup after PR66 review fixes"
```

---

## Summary

| Batch | Tasks  | Focus                                               | Est. Time |
| ----- | ------ | --------------------------------------------------- | --------- |
| 1     | T1–T3  | Critical: multi-tenant isolation, schema migration  | 45 min    |
| 2     | T4–T6  | Architecture: domain imports, dedup, route loader   | 60 min    |
| 3     | T7–T8  | Error handling: narrow catch, ref→state             | 20 min    |
| 4     | T9–T15 | UI quality: cn(), keys, docstring, Link, validation | 30 min    |
| 5     | T16    | Verification: tsc + vitest                          | 5 min     |

**Total: ~2.5 hours. 16 tasks across 5 batches.**
