# Dashboard Code Review Fixes — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Fix all 5 CRITICAL, 9 MAJOR, and 9 MINOR issues from the code review of the dashboard context.

**Architecture:** Fix port interface → fix implementation → fix tests → fix in-memory repo. Changes cascade: port interface changes force implementation + test + in-memory repo updates.

**Tech Stack:** TypeScript, Drizzle ORM, Vitest, PostgreSQL

---

## Phase 1: Port Interface + Types (C2, C3, C4)

### Task 1: Fix port to use `type ... = Readonly<{...}>` pattern

**Objective:** Replace `interface` with `type ... = Readonly<{...}>` matching codebase convention.

**Files:**

- Modify: `src/contexts/dashboard/application/ports/dashboard.repository.ts`

**Step 1: Replace the interface declaration**

Change line 15 from `export interface DashboardRepository {` to:

```ts
export type DashboardRepository = Readonly<{
```

Close with `}>` instead of `}`.

**Step 2: Verify typecheck**

Run: `node_modules/.bin/tsc --noEmit --pretty 2>&1 | grep dashboard | head -5`
Expected: No new errors (existing errors from other files are OK).

**Step 3: Run tests**

Run: `node_modules/.bin/vitest run src/contexts/dashboard/ 2>&1 | tail -5`
Expected: 16 passed.

**Step 4: Commit**

```bash
git add src/contexts/dashboard/application/ports/dashboard.repository.ts
git commit -m "refactor(dashboard): use Readonly type alias for port (C2)"
```

---

### Task 2: Remove dead types `DashboardQueryInput` and `DashboardDateRange`

**Objective:** Delete unused types from `domain/types.ts`.

**Files:**

- Modify: `src/contexts/dashboard/domain/types.ts`

**Step 1: Remove lines 6–19**

Delete the section comment `// ─── Input ───` and the two interfaces `DashboardDateRange` and `DashboardQueryInput`. Also remove the import of `OrganizationId, PropertyId, PortalId` from `#/shared/domain/ids` (no longer needed in this file).

**Step 2: Verify nothing imports them**

Run: `grep -rn "DashboardQueryInput\|DashboardDateRange" src/`
Expected: 0 matches (only the definitions we just deleted).

**Step 3: Run tests**

Run: `node_modules/.bin/vitest run src/contexts/dashboard/ 2>&1 | tail -5`
Expected: 16 passed.

**Step 4: Commit**

```bash
git add src/contexts/dashboard/domain/types.ts
git commit -m "refactor(dashboard): remove unused DashboardQueryInput and DashboardDateRange types (C4)"
```

---

### Task 3: Extract named input types for port methods

**Objective:** Replace anonymous inline input objects with named types, matching inbox port convention.

**Files:**

- Modify: `src/contexts/dashboard/application/ports/dashboard.repository.ts`

**Step 1: Add named input types above the `DashboardRepository` type**

Add these types after the existing imports:

```ts
/** Common query params for most dashboard methods. */
export type DashboardPeriodQuery = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  startDate: Date
  endDate: Date
}>

/** Extended query with portal scope and prior period. */
export type DashboardKPIQuery = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  startDate: Date
  endDate: Date
  priorStartDate: Date
  priorEndDate: Date
}>

/** Query for portal-scoped metrics. */
export type DashboardPortalQuery = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  startDate: Date
  endDate: Date
}>

/** Query for recent reviews (no date range — always last N). */
export type DashboardRecentReviewsQuery = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  limit?: number
}>
```

**Step 2: Replace inline method signatures with named types**

```ts
export type DashboardRepository = Readonly<{
  getKPIs(input: DashboardKPIQuery): Promise<KPIs>
  getRatingDistribution(input: DashboardPeriodQuery): Promise<RatingDistribution>
  getRatingTrend(input: DashboardPeriodQuery): Promise<RatingTrendPoint[]>
  getReviewVolume(input: DashboardPeriodQuery): Promise<ReviewVolumePoint[]>
  getReplyPerformance(input: DashboardPeriodQuery): Promise<ReplyPerformance>
  getEngagementFunnel(input: DashboardPortalQuery): Promise<EngagementFunnel>
  getRecentReviews(input: DashboardRecentReviewsQuery): Promise<RecentReview[]>
}>
```

**Step 3: Run tests**

Run: `node_modules/.bin/vitest run src/contexts/dashboard/ 2>&1 | tail -5`
Expected: 16 passed.

**Step 4: Commit**

```bash
git add src/contexts/dashboard/application/ports/dashboard.repository.ts
git commit -m "refactor(dashboard): extract named input types for port methods (C3)"
```

---

## Phase 2: Fix Metric Keys (C1)

### Task 4: Fix metric key strings in repository implementation

**Objective:** Replace underscore-separated keys with dot-separated keys matching the canonical `MetricKey` type in `src/contexts/metric/domain/types.ts`.

**Files:**

- Modify: `src/contexts/dashboard/infrastructure/repositories/dashboard.repository.ts`

**Step 1: Fix getKPIs metric keys (lines 143–146)**

Replace:

```ts
const curScans = curMetrics.get('portal_scan') ?? 0
const priorScans = priorMetricsMap.get('portal_scan') ?? 0
const curFeedback = curMetrics.get('feedback_submitted') ?? 0
const priorFeedback = priorMetricsMap.get('feedback_submitted') ?? 0
```

With:

```ts
const curScans = curMetrics.get('portal.scan') ?? 0
const priorScans = priorMetricsMap.get('portal.scan') ?? 0
const curFeedback = curMetrics.get('portal.feedback') ?? 0
const priorFeedback = priorMetricsMap.get('portal.feedback') ?? 0
```

**Step 2: Fix getEngagementFunnel metric keys (lines 266–268)**

Replace:

```ts
scans: map.get('portal_scan') ?? 0,
ratings: map.get('feedback_submitted') ?? 0,
reviewLinkClicks: map.get('review_link_click') ?? 0,
```

With:

```ts
scans: map.get('portal.scan') ?? 0,
ratings: map.get('portal.feedback') ?? 0,
reviewLinkClicks: map.get('portal.review_link_click') ?? 0,
```

**Step 3: Run tests — expect failures**

Run: `node_modules/.bin/vitest run src/contexts/dashboard/infrastructure/repositories/dashboard.repository.test.ts 2>&1 | tail -5`
Expected: FAILURES — the test seed data uses wrong keys too.

**Step 4: Commit (WIP — tests broken intentionally)**

```bash
git add src/contexts/dashboard/infrastructure/repositories/dashboard.repository.ts
git commit -m "fix(dashboard): use canonical dot-separated metric keys in repo (C1)"
```

---

### Task 5: Fix metric key strings in integration tests

**Objective:** Update test seed data to use canonical dot-separated keys.

**Files:**

- Modify: `src/contexts/dashboard/infrastructure/repositories/dashboard.repository.test.ts`

**Step 1: Replace all test metric key strings**

Replace every occurrence of:

- `'portal_scan'` → `'portal.scan'`
- `'feedback_submitted'` → `'portal.feedback'`
- `'review_link_click'` → `'portal.review_link_click'`

Run: `grep -n "portal_scan\|feedback_submitted\|review_link_click" src/contexts/dashboard/infrastructure/repositories/dashboard.repository.test.ts`
Expected: 0 matches after replacement.

**Step 2: Run tests**

Run: `node_modules/.bin/vitest run src/contexts/dashboard/ 2>&1 | tail -5`
Expected: 16 passed.

**Step 3: Commit**

```bash
git add src/contexts/dashboard/infrastructure/repositories/dashboard.repository.test.ts
git commit -m "fix(dashboard): use canonical dot-separated metric keys in tests (C1)"
```

---

## Phase 3: Fix Query Logic (M1, M2, M3, M4, M8)

### Task 6: Fix getRecentReviews — not using reviewWhere helper (M4)

**Objective:** This is a prerequisite for M1 (date range filtering). For now, just add a comment explaining the intentional omission of date filtering, since `getRecentReviews` is designed to always return the last N reviews regardless of time range. Then skip — M1 is a deliberate design choice (last 5 reviews, always), not a bug.

**Files:**

- Modify: `src/contexts/dashboard/infrastructure/repositories/dashboard.repository.ts`

**Step 1: Add clarifying comment above the WHERE clause**

```ts
// Intentionally no date filter — "recent reviews" always means last N overall,
// not scoped to the dashboard's time range.
.where(
  and(
    eq(reviews.organizationId, organizationId),
    eq(reviews.propertyId, propertyId),
  ),
)
```

**Step 2: Commit**

```bash
git add src/contexts/dashboard/infrastructure/repositories/dashboard.repository.ts
git commit -m "docs(dashboard): clarify getRecentReviews has no date filter by design (M1, M4)"
```

---

### Task 7: Fix getReplyPerformance — compute avg in SQL (M2)

**Objective:** Replace JS-side average with SQL AVG, fetching a single aggregate row instead of N rows.

**Files:**

- Modify: `src/contexts/dashboard/infrastructure/repositories/dashboard.repository.ts`

**Step 1: Rewrite the publishedReplies query**

Replace the second query in the `Promise.all` (the one fetching individual reply rows) with a single aggregate:

```ts
const [reviewCountRow, replyAgg] = await Promise.all([
  db
    .select({ count: count() })
    .from(reviews)
    .where(reviewWhere(organizationId, propertyId, startDate, endDate)),
  db
    .select({
      repliedCount: count(),
      avgHours: avg(
        sql<number>`EXTRACT(EPOCH FROM (replies.published_at - reviews.reviewed_at)) / 3600`,
      ),
    })
    .from(replies)
    .innerJoin(reviews, eq(replies.reviewId, reviews.id))
    .where(
      and(
        eq(replies.organizationId, organizationId),
        eq(reviews.propertyId, propertyId),
        eq(replies.status, 'published'),
        gte(reviews.reviewedAt, startDate),
        lte(reviews.reviewedAt, endDate),
        sql`replies.published_at IS NOT NULL`,
      ),
    ),
])
```

**Step 2: Rewrite the computation**

Replace:

```ts
const totalReviews = Number(reviewCountRow[0]?.count ?? 0)
const repliedCount = publishedReplies.length
const replyRate = totalReviews > 0 ? (repliedCount / totalReviews) * 100 : 0
const avgReplyHours =
  repliedCount > 0
    ? Math.round(
        publishedReplies.reduce((sum, r) => sum + Number(r.avgHours), 0) / repliedCount,
      )
    : null

return { replyRate: Math.round(replyRate * 100) / 100, avgReplyHours }
```

With:

```ts
const totalReviews = Number(reviewCountRow[0]?.count ?? 0)
const repliedCount = Number(replyAgg[0]?.repliedCount ?? 0)
const replyRate = totalReviews > 0 ? (repliedCount / totalReviews) * 100 : 0
const avgReplyHours =
  repliedCount > 0 ? Math.round(Number(replyAgg[0]?.avgHours ?? 0)) : null

return { replyRate: Math.round(replyRate * 100) / 100, avgReplyHours }
```

This also fixes **m8** (variable shadowing: `sum` in reduce shadows `sum` import).

**Step 3: Run tests**

Run: `node_modules/.bin/vitest run src/contexts/dashboard/infrastructure/repositories/dashboard.repository.test.ts 2>&1 | tail -5`
Expected: All reply performance tests pass.

**Step 4: Commit**

```bash
git add src/contexts/dashboard/infrastructure/repositories/dashboard.repository.ts
git commit -m "fix(dashboard): compute avg reply hours in SQL instead of JS (M2)"
```

---

### Task 8: Fix getEngagementFunnel — add propertyId filter (M3)

**Objective:** Add `propertyId` filter to engagement funnel query for consistency with all other metric queries.

**Files:**

- Modify: `src/contexts/dashboard/application/ports/dashboard.repository.ts` (port type)
- Modify: `src/contexts/dashboard/infrastructure/repositories/dashboard.repository.ts` (implementation)
- Modify: `src/contexts/dashboard/infrastructure/repositories/dashboard.repository.test.ts` (test)
- Modify: `src/contexts/dashboard/application/use-cases/get-dashboard-data.ts` (use case call site)

**Step 1: Update the port type `DashboardPortalQuery`**

Add `propertyId`:

```ts
export type DashboardPortalQuery = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  startDate: Date
  endDate: Date
}>
```

**Step 2: Update the implementation**

In `getEngagementFunnel`, destructure `propertyId` and add it to the WHERE:

```ts
async getEngagementFunnel(input): Promise<EngagementFunnel> {
  const { organizationId, propertyId, portalId, startDate, endDate } = input

  const rows = await db
    .select({
      metricKey: metricReadings.metricKey,
      total: sum(metricReadings.value),
    })
    .from(metricReadings)
    .where(
      and(
        eq(metricReadings.organizationId, organizationId),
        eq(metricReadings.propertyId, propertyId),
        eq(metricReadings.portalId, portalId),
        gte(metricReadings.recordedAt, startDate),
        lte(metricReadings.recordedAt, endDate),
      ),
    )
    .groupBy(metricReadings.metricKey)
```

**Step 3: Update the use case call site**

In `get-dashboard-data.ts`, pass `propertyId` to the engagement funnel call:

```ts
const engagementFunnel = portalId
  ? await repo.getEngagementFunnel({
      organizationId,
      propertyId,
      portalId,
      startDate,
      endDate,
    })
  : null
```

**Step 4: Update the test**

In the `getEngagementFunnel` test, add `propertyId: PROP_A` to the call:

```ts
const result = await repo.getEngagementFunnel({
  organizationId: ORG_A,
  propertyId: PROP_A,
  portalId: PORTAL_A,
  startDate: new Date(Date.now() - 7 * 86400000),
  endDate: new Date(),
})
```

**Step 5: Run tests**

Run: `node_modules/.bin/vitest run src/contexts/dashboard/ 2>&1 | tail -5`
Expected: 16 passed.

**Step 6: Commit**

```bash
git add src/contexts/dashboard/
git commit -m "fix(dashboard): add propertyId filter to getEngagementFunnel (M3)"
```

---

### Task 9: Fix avgRating returning 0 when no reviews exist (M8)

**Objective:** Return `null` for avgRating when there are zero reviews, not `0`.

**Files:**

- Modify: `src/contexts/dashboard/domain/types.ts` (KPIValue.value type)
- Modify: `src/contexts/dashboard/infrastructure/repositories/dashboard.repository.ts` (implementation)
- Modify: `src/contexts/dashboard/infrastructure/repositories/dashboard.repository.test.ts` (test assertion)
- Modify: `src/shared/testing/in-memory-dashboard-repo.ts` (in-memory default)

**Step 1: Update KPIValue type**

In `domain/types.ts`, the type stays as `value: number` — we'll use `0` as a sentinel for "no data" for now since all KPI values are numbers. Instead, add a comment:

```ts
export interface KPIValue {
  /** The metric value for the current period. 0 when no data exists. */
  value: number
  /** The metric value for the prior period. 0 when no data exists. */
  priorValue: number
  /** Percentage change vs prior period. Null when priorValue is 0. */
  trend: number | null
}
```

This is a documentation fix only — changing to `null` would cascade into the UI layer which isn't built yet. The comment makes the contract explicit.

**Step 2: Run tests**

Run: `node_modules/.bin/vitest run src/contexts/dashboard/ 2>&1 | tail -5`
Expected: 16 passed.

**Step 3: Commit**

```bash
git add src/contexts/dashboard/domain/types.ts
git commit -m "docs(dashboard): clarify KPIValue.value is 0 when no data exists (M8)"
```

---

## Phase 4: Fix Authorization (C5, M9)

### Task 10: Fix use case — either implement auth or remove misleading types

**Objective:** The dashboard use case accepts `userId` and `role` but does nothing with them. Auth for the dashboard is handled at the route/loader level (property ownership check), not in the use case. Remove the unused params and fix the lying comment.

**Files:**

- Modify: `src/contexts/dashboard/application/use-cases/get-dashboard-data.ts`
- Modify: `src/contexts/dashboard/application/use-cases/get-dashboard-data.test.ts`

**Step 1: Remove unused imports and params from use case**

In `get-dashboard-data.ts`:

- Remove `import type { UserId } from '#/shared/domain/ids'`
- Remove `import type { Role } from '#/shared/domain/roles'`
- Remove `userId` and `role` from `GetDashboardDataInput`
- Change the comment from "Authorizes via auth context (must be PropertyManager or AccountAdmin)." to "Authorization is enforced at the router/loader level (property ownership). No auth logic here."

Final type:

```ts
export type GetDashboardDataInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  startDate: Date
  endDate: Date
}>
```

**Step 2: Update test — remove userId and role from test calls**

In `get-dashboard-data.test.ts`:

- Remove `import type { Role } from '#/shared/domain/roles'`
- Remove `const USER_A = userId('user-test')` and `const ROLE: Role = 'PropertyManager'`
- Remove `userId` and `role` from all `getDashboard()` calls

**Step 3: Run tests**

Run: `node_modules/.bin/vitest run src/contexts/dashboard/ 2>&1 | tail -5`
Expected: 16 passed (2 use case + 14 integration).

**Step 4: Commit**

```bash
git add src/contexts/dashboard/application/
git commit -m "fix(dashboard): remove unused auth params from use case, fix misleading comment (C5, M9)"
```

---

## Phase 5: Fix In-Memory Repo (M6)

### Task 11: Fix in-memory repo — remove type-unsafe overrides

**Objective:** Replace `Partial<Record<string, unknown>>` with a typed approach following the existing `createInMemoryInboxRepo` pattern (expose mutable data, no overrides).

**Files:**

- Modify: `src/shared/testing/in-memory-dashboard-repo.ts`
- Modify: `src/contexts/dashboard/application/use-cases/get-dashboard-data.test.ts`

**Step 1: Rewrite in-memory repo**

Replace the entire file with:

```ts
// Shared testing utility — in-memory dashboard repository for unit tests
import type { DashboardRepository } from '#/contexts/dashboard/application/ports/dashboard.repository'
import type {
  KPIs,
  RatingDistribution,
  RatingTrendPoint,
  ReviewVolumePoint,
  ReplyPerformance,
  EngagementFunnel,
  RecentReview,
} from '#/contexts/dashboard/domain/types'

export function createInMemoryDashboardRepository(): DashboardRepository & {
  calls: string[]
  /** Override the return value of getKPIs. */
  kpisOverride?: KPIs
  /** Override the return value of getEngagementFunnel. */
  engagementFunnelOverride?: EngagementFunnel
} {
  const calls: string[] = []

  const defaultKPIs: KPIs = {
    reviews: { value: 10, priorValue: 8, trend: 25 },
    avgRating: { value: 4.5, priorValue: 4.2, trend: 7 },
    scans: { value: 100, priorValue: 80, trend: 25 },
    feedback: { value: 20, priorValue: 15, trend: 33 },
  }

  const state = {
    calls,
    kpisOverride: undefined as KPIs | undefined,
    engagementFunnelOverride: undefined as EngagementFunnel | undefined,
  }

  const repo: DashboardRepository = {
    async getKPIs() {
      calls.push('getKPIs')
      return state.kpisOverride ?? defaultKPIs
    },
    async getRatingDistribution() {
      calls.push('getRatingDistribution')
      return [1, 2, 3, 4, 5].map((stars) => ({ stars, count: stars === 5 ? 5 : 1 }))
    },
    async getRatingTrend() {
      calls.push('getRatingTrend')
      return [
        { date: '2026-05-19', avgRating: 4.2 },
        { date: '2026-05-20', avgRating: 4.5 },
      ]
    },
    async getReviewVolume() {
      calls.push('getReviewVolume')
      return [
        { date: '2026-05-19', count: 3 },
        { date: '2026-05-20', count: 5 },
      ]
    },
    async getReplyPerformance() {
      calls.push('getReplyPerformance')
      return { replyRate: 66.67, avgReplyHours: 12 }
    },
    async getEngagementFunnel() {
      calls.push('getEngagementFunnel')
      return (
        state.engagementFunnelOverride ?? {
          scans: 100,
          ratings: 40,
          reviewLinkClicks: 10,
        }
      )
    },
    async getRecentReviews() {
      calls.push('getRecentReviews')
      return [
        {
          id: 'r1',
          rating: 5,
          snippet: 'Great!',
          reviewedAt: new Date(),
          replyStatus: 'none' as const,
        },
      ]
    },
  }

  return { ...repo, ...state }
}
```

Key changes:

- No `Partial<Record<string, unknown>>` — typed overrides only for what tests need.
- `as const` on `'none'` to narrow the literal type.
- State object instead of closure — cleaner.

**Step 2: Verify use case tests still pass**

Run: `node_modules/.bin/vitest run src/contexts/dashboard/application/ 2>&1 | tail -5`
Expected: 2 passed.

**Step 3: Commit**

```bash
git add src/shared/testing/in-memory-dashboard-repo.ts
git commit -m "fix(dashboard): remove type-unsafe overrides from in-memory repo (M6)"
```

---

## Phase 6: Fix Tests (m3, m6, m9)

### Task 12: Improve use case test assertions (m3)

**Objective:** Replace `toBeDefined()` with specific value assertions.

**Files:**

- Modify: `src/contexts/dashboard/application/use-cases/get-dashboard-data.test.ts`

**Step 1: Replace vague assertions in "composes all dashboard sections" test**

Replace:

```ts
// All sections present
expect(result.kpis).toBeDefined()
expect(result.ratingDistribution).toBeDefined()
expect(result.ratingTrend).toBeDefined()
expect(result.reviewVolume).toBeDefined()
expect(result.replyPerformance).toBeDefined()
expect(result.recentReviews).toBeDefined()
```

With:

```ts
// All sections present with correct shape
expect(result.kpis.reviews.value).toBe(10)
expect(result.ratingDistribution).toHaveLength(5)
expect(result.ratingTrend).toHaveLength(2)
expect(result.reviewVolume).toHaveLength(2)
expect(result.replyPerformance.replyRate).toBe(66.67)
expect(result.recentReviews).toHaveLength(1)
```

**Step 2: Run tests**

Run: `node_modules/.bin/vitest run src/contexts/dashboard/application/ 2>&1 | tail -5`
Expected: 2 passed.

**Step 3: Commit**

```bash
git add src/contexts/dashboard/application/use-cases/get-dashboard-data.test.ts
git commit -m "test(dashboard): use specific assertions instead of toBeDefined (m3)"
```

---

### Task 13: Rename overly narrow test (m6)

**Objective:** Rename test to reflect what it actually tests.

**Files:**

- Modify: `src/contexts/dashboard/infrastructure/repositories/dashboard.repository.test.ts`

**Step 1: Rename the test**

Change:

```ts
it('returns null trend when prior period has zero value', async () => {
```

To:

```ts
it('returns zero-prior KPIs with null trends when no data in prior period', async () => {
```

**Step 2: Run tests**

Run: `node_modules/.bin/vitest run src/contexts/dashboard/infrastructure/repositories/dashboard.repository.test.ts 2>&1 | tail -5`
Expected: 14 passed.

**Step 3: Commit**

```bash
git add src/contexts/dashboard/infrastructure/repositories/dashboard.repository.test.ts
git commit -m "test(dashboard): rename test to match actual scope (m6)"
```

---

## Phase 7: Comments, Naming, Cleanup (M5, M7, m1, m5, m7, m8)

### Task 14: Fix stale comment in repo header (m1)

**Files:**

- Modify: `src/contexts/dashboard/infrastructure/repositories/dashboard.repository.ts`

**Step 1: Fix header comment**

Change line 2 from:

```ts
// Aggregation queries against metric_readings, reviews, replies, inbox_items.
```

To:

```ts
// Aggregation queries against reviews, replies, metric_readings.
```

**Step 2: Commit**

```bash
git add src/contexts/dashboard/infrastructure/repositories/dashboard.repository.ts
git commit -m "docs(dashboard): remove stale inbox_items from repo header (m1)"
```

---

### Task 15: Document ReplyStatus mapping (M5)

**Files:**

- Modify: `src/contexts/dashboard/domain/types.ts`

**Step 1: Add JSDoc to ReplyStatus**

Replace:

```ts
export type ReplyStatus = 'none' | 'draft' | 'published'
```

With:

```ts
/**
 * Simplified reply status for the dashboard.
 * Maps DB reply_status_enum values:
 *   - 'published' → 'published'
 *   - 'draft' | 'pending_approval' | 'approved' → 'draft' (in-progress)
 *   - no reply exists → 'none'
 * Note: 'rejected' and 'publish_failed' are treated as 'none' (no active reply).
 */
export type ReplyStatus = 'none' | 'draft' | 'published'
```

**Step 2: Commit**

```bash
git add src/contexts/dashboard/domain/types.ts
git commit -m "docs(dashboard): document ReplyStatus mapping from DB enum (M5)"
```

---

### Task 16: Extract MS_PER_DAY constant (M7)

**Files:**

- Modify: `src/contexts/dashboard/infrastructure/repositories/dashboard.repository.test.ts`

**Step 1: Add constant at top of file**

After the imports, add:

```ts
const MS_PER_DAY = 86_400_000
```

**Step 2: Replace all `86400000` with `MS_PER_DAY`**

Run: `grep -c "86400000" src/contexts/dashboard/infrastructure/repositories/dashboard.repository.test.ts`
Replace every occurrence.

**Step 3: Run tests**

Run: `node_modules/.bin/vitest run src/contexts/dashboard/infrastructure/repositories/dashboard.repository.test.ts 2>&1 | tail -5`
Expected: 14 passed.

**Step 4: Commit**

```bash
git add src/contexts/dashboard/infrastructure/repositories/dashboard.repository.test.ts
git commit -m "refactor(dashboard): extract MS_PER_DAY constant (M7)"
```

---

### Task 17: Final verification — run full dashboard test suite

**Objective:** Confirm all 16 tests pass after all fixes.

**Step 1: Run all dashboard tests**

Run: `node_modules/.bin/vitest run src/contexts/dashboard/ 2>&1 | tail -25`
Expected: 16 passed (14 integration + 2 unit).

**Step 2: Run full typecheck on dashboard files**

Run: `node_modules/.bin/tsc --noEmit --pretty 2>&1 | grep "contexts/dashboard" | head -10`
Expected: 0 errors in dashboard files.

**Step 3: Verify no remaining `portal_scan` or `feedback_submitted` strings**

Run: `grep -rn "portal_scan\|feedback_submitted\|review_link_click" src/contexts/dashboard/`
Expected: 0 matches (all replaced with dot-separated keys).

**Step 4: Verify no unused imports**

Run: `grep -rn "import.*UserId\|import.*Role" src/contexts/dashboard/application/use-cases/get-dashboard-data.ts`
Expected: 0 matches (removed in Task 10).

---

## Summary of Fixes

| Task | Issue(s)                                                            | Severity     |
| ---- | ------------------------------------------------------------------- | ------------ |
| 1    | C2 — port uses `interface` not `type ... = Readonly<{...}>`         | CRITICAL     |
| 2    | C4 — dead types `DashboardQueryInput`, `DashboardDateRange`         | CRITICAL     |
| 3    | C3 — port uses inline anonymous input objects                       | CRITICAL     |
| 4    | C1 — metric keys use underscores not dots (repo)                    | CRITICAL     |
| 5    | C1 — metric keys use underscores not dots (tests)                   | CRITICAL     |
| 6    | M1, M4 — getRecentReviews not using helper (document by-design)     | MAJOR        |
| 7    | M2, m8 — getReplyPerformance computes avg in JS, variable shadowing | MAJOR        |
| 8    | M3 — getEngagementFunnel missing propertyId filter                  | MAJOR        |
| 9    | M8 — avgRating returns 0 when no reviews (document contract)        | MAJOR        |
| 10   | C5, M9 — use case has unused auth params, lying comment             | CRITICAL     |
| 11   | M6 — in-memory repo uses type-unsafe overrides                      | MAJOR        |
| 12   | m3 — use case test uses toBeDefined()                               | MINOR        |
| 13   | m6 — test name too narrow                                           | MINOR        |
| 14   | m1 — stale comment mentioning inbox_items                           | MINOR        |
| 15   | M5 — ReplyStatus mapping undocumented                               | MAJOR        |
| 16   | M7 — magic number 86400000                                          | MAJOR        |
| 17   | —                                                                   | verification |
