# Dashboard Review #2 Fixes — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Fix all 3 CRITICAL, 6 MAJOR, and 6 MINOR issues from review #2.

**Architecture:** Type-level refactor (convention alignment), rename (ReplyStatus → DashboardReplyStatus), KPI portalId removal (design fix), defensive coding additions.

**Test command:** `node_modules/.bin/vitest run src/contexts/dashboard/ 2>&1 | tail -5`

---

## Batch A: Independent file modifications (parallel)

### Task 1: Convert domain types from `interface` to `type = Readonly<{...}>` (C2)

**TDD:** Skip — pure type-level refactor, no behavior change.

**File:** `src/contexts/dashboard/domain/types.ts`

Replace all `interface` declarations with `type ... = Readonly<{...}>`. Keep the JSDoc comments. Rename `ReplyStatus` to `DashboardReplyStatus`.

**New file content:**

```ts
// Dashboard context — domain response shapes
// Read-only aggregation surface. No domain rules, no events, no writes.

// ─── KPI Strip ───

export type KPIValue = Readonly<{
  /** The metric value for the current period. 0 when no data exists. */
  value: number
  /** The metric value for the prior period. 0 when no data exists. */
  priorValue: number
  /** Percentage change vs prior period. Null when priorValue is 0. */
  trend: number | null
}>

export type KPIs = Readonly<{
  reviews: KPIValue
  avgRating: KPIValue
  scans: KPIValue
  feedback: KPIValue
}>

// ─── Rating Distribution ───

export type RatingBucket = Readonly<{
  stars: number
  count: number
}>

export type RatingDistribution = readonly RatingBucket[]

// ─── Charts ───

export type RatingTrendPoint = Readonly<{
  date: string // YYYY-MM-DD
  avgRating: number
}>

export type ReviewVolumePoint = Readonly<{
  date: string // YYYY-MM-DD or YYYY-WNN for weekly
  count: number
}>

// ─── Reply Performance ───

export type ReplyPerformance = Readonly<{
  /** % of reviews with a published reply (0–100) */
  replyRate: number
  /** Average hours from reviewedAt to publishedAt. Null when no replies. */
  avgReplyHours: number | null
}>

// ─── Engagement Funnel ───

export type EngagementFunnel = Readonly<{
  scans: number
  ratings: number
  reviewLinkClicks: number
}>

// ─── Recent Reviews ───

/**
 * Simplified reply status for the dashboard.
 * Maps DB reply_status_enum values:
 *   - 'published' → 'published'
 *   - 'draft' | 'pending_approval' | 'approved' → 'draft' (in-progress)
 *   - no reply exists → 'none'
 * Note: 'rejected' and 'publish_failed' are treated as 'none' (no active reply).
 */
export type DashboardReplyStatus = 'none' | 'draft' | 'published'

export type RecentReview = Readonly<{
  id: string
  rating: number
  snippet: string
  reviewedAt: Date
  replyStatus: DashboardReplyStatus
}>

// ─── Full Dashboard Response ───

export type DashboardData = Readonly<{
  kpis: KPIs
  ratingDistribution: RatingDistribution
  ratingTrend: RatingTrendPoint[]
  reviewVolume: ReviewVolumePoint[]
  replyPerformance: ReplyPerformance
  engagementFunnel: EngagementFunnel | null
  recentReviews: RecentReview[]
}>
```

**Verification:** `node_modules/.bin/vitest run src/contexts/dashboard/ 2>&1 | tail -5` — all 16 tests still pass.

**Commit:** `git add src/contexts/dashboard/domain/types.ts && git commit -m "refactor(dashboard): convert domain types to type Readonly (C2)"`

---

### Task 2: Update repo to use `DashboardReplyStatus` + add type guard (C1, C3)

**TDD:** Skip — rename + type guard addition.

**Files:**
- `src/contexts/dashboard/infrastructure/repositories/dashboard.repository.ts`
- `src/contexts/dashboard/domain/types.ts` (add validation function)

**Step 1:** In `types.ts`, add a validation function after `DashboardReplyStatus`:

```ts
const DASHBOARD_REPLY_STATUSES = new Set<string>(['none', 'draft', 'published'])

/** Validate that a SQL CASE result is a valid DashboardReplyStatus. */
export function toDashboardReplyStatus(value: string): DashboardReplyStatus {
  if (!DASHBOARD_REPLY_STATUSES.has(value)) {
    throw new Error(`Invalid DashboardReplyStatus: "${value}"`)
  }
  return value as DashboardReplyStatus
}
```

**Step 2:** In `dashboard.repository.ts`:

Update the import to replace `ReplyStatus` with `DashboardReplyStatus, toDashboardReplyStatus`:

```ts
import type {
  KPIs,
  RatingDistribution,
  RatingTrendPoint,
  ReviewVolumePoint,
  ReplyPerformance,
  EngagementFunnel,
  RecentReview,
} from '../../domain/types'
import { toDashboardReplyStatus } from '../../domain/types'
```

(Note: `DashboardReplyStatus` is a type used by `RecentReview` — no direct import needed since it's already part of the `RecentReview` type.)

Replace the unsafe cast:
```ts
// Before:
replyStatus: row.replyStatus as ReplyStatus,

// After:
replyStatus: toDashboardReplyStatus(row.replyStatus),
```

**Verification:** `node_modules/.bin/vitest run src/contexts/dashboard/ 2>&1 | tail -5` — all 16 tests pass.

**Commit:** `git add src/contexts/dashboard/ && git commit -m "refactor(dashboard): rename ReplyStatus to DashboardReplyStatus, add type guard (C1, C3)"`

---

### Task 3: Remove `portalId` from `DashboardKPIQuery` (M5)

**TDD:** Skip — design fix, simplification.

When no portal is selected, KPIs should show property-level aggregates. The portal filter only makes sense for the engagement funnel.

**Files to modify:**
1. `src/contexts/dashboard/application/ports/dashboard.repository.ts` — remove `portalId` from `DashboardKPIQuery`
2. `src/contexts/dashboard/infrastructure/repositories/dashboard.repository.ts` — remove `portalId` from `getKPIs` destructuring, remove `portalId` filter from `metricConditions`
3. `src/contexts/dashboard/application/use-cases/get-dashboard-data.ts` — remove `portalId` from `getKPIs` call
4. `src/contexts/dashboard/infrastructure/repositories/dashboard.repository.test.ts` — remove `portalId: null` from all `getKPIs` test calls

**Exact changes:**

**Port file** — `DashboardKPIQuery` becomes:
```ts
/** Query for KPI aggregation (property-scoped, not portal-scoped). */
export type DashboardKPIQuery = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  startDate: Date
  endDate: Date
  priorStartDate: Date
  priorEndDate: Date
}>
```

**Repo** — `getKPIs` destructuring (line 91):
```ts
// Before:
const { organizationId, propertyId, portalId, startDate, endDate, priorStartDate, priorEndDate } = input

// After:
const { organizationId, propertyId, startDate, endDate, priorStartDate, priorEndDate } = input
```

**Repo** — `metricConditions` (lines 111-118), remove the `portalId` conditional:
```ts
const metricConditions = (start: Date, end: Date) =>
  and(
    eq(metricReadings.organizationId, organizationId),
    eq(metricReadings.propertyId, propertyId),
    gte(metricReadings.recordedAt, start),
    lte(metricReadings.recordedAt, end),
  )
```

**Use case** — remove `portalId` from `repo.getKPIs` call (line 44):
```ts
repo.getKPIs({
  organizationId,
  propertyId,
  startDate,
  endDate,
  priorStartDate,
  priorEndDate,
}),
```

**Test file** — remove `portalId: null` from all `repo.getKPIs({...})` calls (lines 238, 281, 506). Example:
```ts
// Before:
const result = await repo.getKPIs({
  organizationId: ORG_A,
  propertyId: PROP_A,
  portalId: null,
  startDate: ...,
  ...
})

// After:
const result = await repo.getKPIs({
  organizationId: ORG_A,
  propertyId: PROP_A,
  startDate: ...,
  ...
})
```

**Verification:** `node_modules/.bin/vitest run src/contexts/dashboard/ 2>&1 | tail -5` — all 16 tests pass.

**Commit:** `git add src/contexts/dashboard/ && git commit -m "refactor(dashboard): remove portalId from KPI query — KPIs are property-scoped (M5)"`

---

## Batch B: Sequential fixes (depend on Batch A)

### Task 4: Add `isFinite` guard to `trend()` (M6)

**TDD:** Skip — defensive guard, no new test needed.

**File:** `src/contexts/dashboard/infrastructure/repositories/dashboard.repository.ts`

Replace the `trend` function:

```ts
/** Compute trend percentage. Returns null when prior is 0 or result is not finite. */
function trend(current: number, prior: number): number | null {
  if (prior === 0) return null
  const result = ((current - prior) / prior) * 100
  return Number.isFinite(result) ? Math.round(result) : null
}
```

**Verification:** `node_modules/.bin/vitest run src/contexts/dashboard/ 2>&1 | tail -5` — all 16 tests pass.

**Commit:** `git commit -am "fix(dashboard): add isFinite guard to trend calculation (M6)"`

---

### Task 5: Rename `map` variable in `getEngagementFunnel` (m2)

**TDD:** Skip — variable rename.

**File:** `src/contexts/dashboard/infrastructure/repositories/dashboard.repository.ts`

Line 263:
```ts
// Before:
const map = new Map(rows.map((r) => [r.metricKey, Number(r.total ?? 0)]))

// After:
const metricMap = new Map(rows.map((r) => [r.metricKey, Number(r.total ?? 0)]))
```

Lines 266-268:
```ts
// Before:
scans: map.get('portal.scan') ?? 0,
ratings: map.get('portal.feedback') ?? 0,
reviewLinkClicks: map.get('portal.review_link_click') ?? 0,

// After:
scans: metricMap.get('portal.scan') ?? 0,
ratings: metricMap.get('portal.feedback') ?? 0,
reviewLinkClicks: metricMap.get('portal.review_link_click') ?? 0,
```

**Verification:** Tests pass.

**Commit:** `git commit -am "refactor(dashboard): rename map → metricMap in getEngagementFunnel (m2)"`

---

### Task 6: Fix port file header comment (m4)

**TDD:** Skip — comment fix.

**File:** `src/contexts/dashboard/application/ports/dashboard.repository.ts`

```ts
// Before:
// Dashboard context — repository port (interface)

// After:
// Dashboard context — repository port
```

**Commit:** `git commit -am "docs(dashboard): fix stale 'interface' comment in port file (m4)"`

---

### Task 7: Use `MS_PER_DAY` in use case test (M2)

**TDD:** Skip — magic number fix.

**File:** `src/contexts/dashboard/application/use-cases/get-dashboard-data.test.ts`

Add constant after imports:
```ts
const MS_PER_DAY = 86_400_000
```

Replace line 14:
```ts
// Before:
const startDate = new Date(now.getTime() - 30 * 86400000)

// After:
const startDate = new Date(now.getTime() - 30 * MS_PER_DAY)
```

**Verification:** `node_modules/.bin/vitest run src/contexts/dashboard/ 2>&1 | tail -5`

**Commit:** `git commit -am "refactor(dashboard): replace magic 86400000 with MS_PER_DAY in use case test (M2)"`

---

### Task 8: Fix JSDoc to clarify `ELSE` catch-all behavior (m1)

**TDD:** Skip — documentation fix.

**File:** `src/contexts/dashboard/domain/types.ts`

Update the JSDoc for `DashboardReplyStatus`:

```ts
/**
 * Simplified reply status for the dashboard.
 * Maps DB reply_status_enum values:
 *   - 'published' → 'published'
 *   - 'draft' | 'pending_approval' | 'approved' → 'draft' (in-progress)
 *   - 'rejected' | 'publish_failed' | no reply → 'none'
 * SQL CASE uses ELSE 'none' catch-all — new enum variants will map here until explicitly handled.
 */
```

**Commit:** `git commit -am "docs(dashboard): clarify ReplyStatus ELSE catch-all in JSDoc (m1)"`

---

### Task 9: Move `now` inside `it()` blocks in use case test (m6)

**TDD:** Skip — test structure fix.

**File:** `src/contexts/dashboard/application/use-cases/get-dashboard-data.test.ts`

Remove `now` and `startDate` from `describe` scope. Move them into each `it()`:

```ts
describe('getDashboardData (use case)', () => {
  const MS_PER_DAY = 86_400_000

  it('composes all dashboard sections from repo calls', async () => {
    const now = new Date()
    const startDate = new Date(now.getTime() - 30 * MS_PER_DAY)
    const repo = createInMemoryDashboardRepository()
    // ... rest unchanged
  })

  it('includes engagement funnel when portalId is provided', async () => {
    const now = new Date()
    const startDate = new Date(now.getTime() - 30 * MS_PER_DAY)
    const repo = createInMemoryDashboardRepository()
    // ... rest unchanged
  })
})
```

**Verification:** Tests pass.

**Commit:** `git commit -am "refactor(dashboard): move now/startDate inside it() blocks in use case test (m6)"`

---

### Task 10: Add explicit handling for all reply_status_enum values in SQL CASE (m1 supplement)

**TDD:** Write a test first — verify a rejected reply maps to 'none'.

**File:** `src/contexts/dashboard/infrastructure/repositories/dashboard.repository.test.ts`

**Step 1:** Add test for rejected/publish_failed reply statuses:

```ts
it('shows replyStatus as none when reply is rejected', async () => {
  const pool = getPool()
  await seedProperty(pool, PROP_A, ORG_A)

  const reviewId = await seedReview(pool, { rating: 3, text: 'Meh' })
  await pool.query(
    `INSERT INTO replies (id, review_id, organization_id, text, status, source)
     VALUES ($1, $2, $3, 'Rejected reply', 'rejected', 'internal')`,
    [crypto.randomUUID(), reviewId, ORG_A],
  )

  const db = getDb()
  const repo = createDashboardRepository(db)
  const result = await repo.getRecentReviews({
    organizationId: ORG_A,
    propertyId: PROP_A,
    limit: 5,
  })

  expect(result).toHaveLength(1)
  expect(result[0].replyStatus).toBe('none')
})
```

**Step 2:** Run test — should PASS (ELSE catch-all handles this).

**Step 3:** Update SQL CASE in repo to be explicit about all enum values:

```ts
replyStatus: sql<string>`
  CASE
    WHEN EXISTS (
      SELECT 1 FROM replies
      WHERE replies.review_id = reviews.id
      AND replies.status = 'published'
    ) THEN 'published'
    WHEN EXISTS (
      SELECT 1 FROM replies
      WHERE replies.review_id = reviews.id
      AND replies.status IN ('draft', 'pending_approval', 'approved')
    ) THEN 'draft'
    ELSE 'none'
  END
`.as('reply_status'),
```

This is already the current code — the test confirms correctness. No SQL change needed. The explicit enum handling is already correct via the ELSE.

**Verification:** All 17 tests pass (1 new).

**Commit:** `git commit -am "test(dashboard): add test for rejected reply → 'none' status mapping (m1)"`

---

### Task 11: Final verification

Run full test suite:

```bash
node_modules/.bin/vitest run src/contexts/dashboard/ 2>&1 | tail -25
```

Verify:
- All tests pass (17 expected)
- `grep -rn "interface " src/contexts/dashboard/domain/types.ts` → no matches
- `grep -rn "ReplyStatus" src/contexts/dashboard/domain/types.ts` → only `DashboardReplyStatus`
- `grep -rn "portalId" src/contexts/dashboard/application/ports/dashboard.repository.ts` → only in `DashboardPortalQuery`
- `grep -rn "86400000" src/contexts/dashboard/` → no matches

```bash
git add -A && git commit -m "chore(dashboard): review #2 fixes complete"
```
