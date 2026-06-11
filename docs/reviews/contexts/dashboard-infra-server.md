# Dashboard Context — Infrastructure & Server Layer Review

**Date:** 2026-06-10
**Scope:** `src/contexts/dashboard/infrastructure/`, `src/contexts/dashboard/server/`
**Dimensions:** D5 (repository ports), D7 (multi-tenancy), D8 (server functions), D12 (CONTEXT.md accuracy), D15 (error handling)

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 1     |
| MAJOR    | 3     |
| MINOR    | 3     |
| NIT      | 0     |

---

## Findings

### [D15] [BLOCKER] Swallowed error — `catchUntagged` result not thrown in portal-analytics

File: src/contexts/dashboard/server/portal-analytics.ts:79
Quote:

```ts
if (isDashboardError(e))
  throwContextError('DashboardError', e, dashboardErrorStatus(e.code))
catchUntagged(e)
```

Rule: D15 — no bare catch, no swallowed errors. Errors must be propagated.
Fix: Add `throw` before `catchUntagged(e)` to match the pattern in `dashboard.ts:57` and `staff-dashboard.ts:67`:
`throw catchUntagged(e)`

---

### [D12] [MAJOR] `StaffDashboardData` missing from public-api exports — CONTEXT.md claims it is exported

File: src/contexts/dashboard/application/public-api.ts:6-18
Quote:

```ts
export type {
  KPIValue,
  KPIs,
  RecentReview,
  DashboardReplyStatus,
  DashboardData,
  PortalKPIs,
  PortalAnalyticsData,
} from '../domain/types'
```

Rule: D12 — CONTEXT.md §Public API lists `StaffDashboardData` as exported. Actual public-api.ts omits it.
Fix: Add `StaffDashboardData` to the `export type { ... } from '../domain/types'` statement, or update CONTEXT.md to remove it.

---

### [D8] [MAJOR] Two server files import error types directly from `domain/errors` instead of `public-api`

File: src/contexts/dashboard/server/dashboard.ts:14-15
File: src/contexts/dashboard/server/portal-analytics.ts:18-19
Quote:

```ts
import { isDashboardError } from '../domain/errors'
import type { DashboardErrorCode } from '../domain/errors'
```

Rule: D8 / public-api.ts comment: "server functions must import from public-api, not domain/errors". `staff-dashboard.ts` correctly imports from `'../application/public-api'`.
Fix: Change both imports to `'../application/public-api'` to match the established convention in `staff-dashboard.ts`.

---

### [D8] [MAJOR] Inconsistent error status mapping — portal-analytics uses local `ts-pattern` match instead of shared `standardErrorStatus`

File: src/contexts/dashboard/server/portal-analytics.ts:29-34
Quote:

```ts
const dashboardErrorStatus = (code: DashboardErrorCode): number =>
  match(code)
    .with('forbidden', () => 403)
    .with('not_found', () => 404)
    .with('invalid_input', () => 400)
    .exhaustive()
```

Rule: D8 — server functions should use shared conventions. `dashboard.ts` and `staff-dashboard.ts` both use `standardErrorStatus` from `'#/shared/http/status'`.
Fix: Replace the local `dashboardErrorStatus` function with `import { standardErrorStatus } from '#/shared/http/status'`, matching the other two server files. Remove the `ts-pattern` import.

---

### [D8] [MINOR] Duplicated `timeRangeToDates` and `MS_PER_DAY` in portal-analytics instead of shared import

File: src/contexts/dashboard/server/portal-analytics.ts:36-49
Quote:

```ts
const MS_PER_DAY = 86_400_000
function timeRangeToDates(preset: TimeRangePreset) {
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

Rule: D8 — shared utility already exists at `application/utils.ts`. `dashboard.ts` and `staff-dashboard.ts` both import `timeRangeToDates` from `'../application/utils'`.
Fix: Remove local `MS_PER_DAY` and `timeRangeToDates`. Add `import { timeRangeToDates } from '../application/utils'`.

---

### [D1] [MINOR] domain/types.ts imports from application layer — boundary violation

File: src/contexts/dashboard/domain/types.ts:7-8
Quote:

```ts
// eslint-disable-next-line boundaries/dependencies
import type { PortalRatingTrendPoint } from '../application/ports/portal-metrics.port'
```

Rule: D1 — domain/ may only import from itself and shared/domain/. Importing from application/ports violates the dependency direction.
Fix: Move `PortalRatingTrendPoint` to `shared/domain/` or to `domain/types.ts` itself, then have the port import it from there. Remove the eslint-disable comment.

---

### [D5] [MINOR] Port `StaffPortalResolverPort` is a bare function type, not an interface with factory — inconsistent with other ports

File: src/contexts/dashboard/application/ports/staff-portal-resolver.port.ts:9-12
Quote:

```ts
export type StaffPortalResolverPort = (
  input: { userId: UserId; propertyId: PropertyId },
  ctx: AuthContext,
) => Promise<ReadonlyArray<PortalId>>
```

Rule: D5 — ports should be interface types with named methods, not bare function types. Other dashboard ports (`MetricStatsPort`, `ReviewStatsPort`, `PortalMetricsPort`, `DashboardRepository`) all use `Readonly<{ method(): Promise<...> }>` shape.
Fix: Convert to an interface with a named method (e.g., `resolvePortals(input, ctx)`). Update all callers accordingly.

---

## D7 Multi-Tenancy Verification

Every SQL query in the infrastructure layer includes `organizationId`:

| Adapter        | Method                        | orgId filter                                                                    |
| -------------- | ----------------------------- | ------------------------------------------------------------------------------- |
| metric-stats   | `getSumsByPeriod`             | ✓ `eq(metricReadings.organizationId, organizationId)`                           |
| metric-stats   | `getSumsByPortal`             | ✓                                                                               |
| metric-stats   | `getSumsByPortals`            | ✓                                                                               |
| metric-stats   | `getCountsByPortal`           | ✓                                                                               |
| portal-metrics | `getPortalKpiSums`            | ✓                                                                               |
| portal-metrics | `getPortalRatingDistribution` | ✓                                                                               |
| portal-metrics | `getPortalRatingTrend`        | ✓                                                                               |
| review-stats   | `getPeriodStats`              | ✓ via `reviewWhere()`                                                           |
| review-stats   | `getRatingDistribution`       | ✓ via `reviewWhere()`                                                           |
| review-stats   | `getRatingTrend`              | ✓ via `reviewWhere()`                                                           |
| review-stats   | `getReviewVolume`             | ✓ via `reviewWhere()`                                                           |
| review-stats   | `getReplyPerformance`         | ✓ double-filtered on both `replies.organizationId` and `reviews.organizationId` |
| review-stats   | `getRecentReviews`            | ✓ `eq(reviews.organizationId, ...)` + subquery scoped by `${organizationId}`    |

All server functions derive `organizationId` from `resolveTenantContext(headers)`, never from client input. **D7 passes fully.**

## D5 Port & Repository Summary

| Port                      | Location           | Factory function                                      | orgId in signatures              |
| ------------------------- | ------------------ | ----------------------------------------------------- | -------------------------------- |
| `DashboardRepository`     | application/ports/ | `createDashboardRepository(reviewStats, metricStats)` | ✓ all input types carry orgId    |
| `MetricStatsPort`         | application/ports/ | `createMetricStatsAdapter(db)`                        | ✓ first param                    |
| `ReviewStatsPort`         | application/ports/ | `createReviewStatsAdapter(db)`                        | ✓ first param                    |
| `PortalMetricsPort`       | application/ports/ | `createPortalMetricsAdapter(db)`                      | ✓ first param                    |
| `StaffPortalResolverPort` | application/ports/ | (function type, no factory)                           | N/A — resolves from auth context |

## D12 CONTEXT.md Accuracy Check

| Claim                                                                                     | Status                                                     |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Events produced: None                                                                     | ✓ No event emitters found                                  |
| Events consumed: None                                                                     | ✓ No event handlers found                                  |
| Server functions: `getDashboardDataFn`, `getPortalAnalyticsFn`, `getStaffDashboardDataFn` | ✓ All exist with correct HTTP methods                      |
| Permission: `dashboard.read` for all functions                                            | ✓ All three use `can(ctx.role, 'dashboard.read')`          |
| Roles: AccountAdmin, PropertyManager, Staff all have `dashboard.read`                     | ✓ Enforced by shared permission matrix                     |
| Public API exports `StaffDashboardData`                                                   | ✗ **Missing from public-api.ts** (see MAJOR finding above) |
| Architecture layers match actual file tree                                                | ✓ Confirmed                                                |
| `build.ts` composition root                                                               | ✓ Matches `buildDashboardContext()`                        |
