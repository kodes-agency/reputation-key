# Dashboard Context — Domain & Application Layer Review

**Reviewer**: automated codebase audit
**Date**: 2026-06-10
**Scope**: `src/contexts/dashboard/domain/`, `src/contexts/dashboard/application/`, `src/contexts/dashboard/build.ts`
**Dimensions**: D2, D3, D4, D11, D12, D15

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 1     |
| MAJOR    | 5     |
| MINOR    | 3     |
| NIT      | 2     |

---

## Findings

### [D11] BLOCKER Domain imports from application layer — boundary inversion

- **File**: `src/contexts/dashboard/domain/types.ts:8`
- **Quote**:
  ```ts
  // eslint-disable-next-line boundaries/dependencies
  import type { PortalRatingTrendPoint } from '../application/ports/portal-metrics.port'
  ```
- **Rule**: D11 — Domain layer must not import from application/. Domain is the innermost layer; it may only import from `shared/domain/`.
- **Fix**: Move `PortalRatingTrendPoint` into `domain/types.ts` (or `shared/domain/`) and have the application port import it from there. Remove the eslint-disable comment.

---

### [D12] MAJOR CONTEXT.md public-api claims `StaffDashboardData` but it is not exported

- **File**: `src/contexts/dashboard/CONTEXT.md:75` vs `src/contexts/dashboard/application/public-api.ts`
- **Quote** (CONTEXT.md):
  ```
  - Types: KPIValue, KPIs, RecentReview, DashboardReplyStatus, DashboardData, PortalKPIs, PortalAnalyticsData, StaffDashboardData
  ```
- **Quote** (public-api.ts): does not include `StaffDashboardData` in any export.
- **Rule**: D12 — CONTEXT.md must match actual code.
- **Fix**: Add `StaffDashboardData` to the type re-exports in `public-api.ts`, or update CONTEXT.md to remove it.

---

### [D12] MAJOR CONTEXT.md architecture diagram omits `application/utils.ts`

- **File**: `src/contexts/dashboard/CONTEXT.md:52-54`
- **Quote**:
  ```
    application/
      ports/             ...
      dto/               dashboard.dto.ts (Zod schemas)
      use-cases/         ...
      public-api.ts      re-exports domain types
  ```
- **Rule**: D12 — CONTEXT.md architecture must reflect actual file tree. `utils.ts` exists at `application/utils.ts` and is imported by 3 consumers (2 server files + 1 infrastructure repo).
- **Fix**: Add `utils.ts` to the architecture listing under `application/`.

---

### [D3] MAJOR `TimeRangePreset` type defined in two conflicting locations

- **File**: `src/contexts/dashboard/application/dto/dashboard.dto.ts:9` and `src/contexts/dashboard/application/utils.ts:5`
- **Quote** (dto):
  ```ts
  export type TimeRangePreset = z.infer<typeof timeRangePreset>
  ```
- **Quote** (utils):
  ```ts
  export type TimeRangePreset = '7d' | '30d' | '60d' | '90d' | 'all'
  ```
- **Rule**: D3/D12 — Single source of truth for types. Use cases import from `dto/dashboard.dto`, while `utils.ts` redefines the same type manually. If zod enum changes, the two definitions silently diverge.
- **Fix**: Remove the `TimeRangePreset` type alias from `utils.ts` and import it from `dto/dashboard.dto.ts`, or vice versa. Consolidate to one definition.

---

### [D3] MAJOR Duplicate `trend` / `computeTrend` function across use case and utils

- **File**: `src/contexts/dashboard/application/use-cases/get-portal-analytics.ts:27-31` and `src/contexts/dashboard/application/utils.ts:22-26`
- **Quote** (use case):
  ```ts
  function trend(current: number, prior: number): number | null {
    if (prior === 0) return null
    const result = ((current - prior) / prior) * 100
    return Number.isFinite(result) ? Math.round(result) : null
  }
  ```
- **Quote** (utils):
  ```ts
  export function computeTrend(current: number, prior: number): number | null {
    if (prior === 0) return null
    const result = ((current - prior) / prior) * 100
    return Number.isFinite(result) ? Math.round(result) : null
  }
  ```
- **Rule**: D3 — Use cases should reuse shared utilities. Identical logic is copy-pasted instead of imported.
- **Fix**: `get-portal-analytics.ts` should import `computeTrend` from `../utils` instead of defining a local `trend`.

---

### [D15] MAJOR Server files `dashboard.ts` and `portal-analytics.ts` import from `domain/errors` instead of `public-api`

- **File**: `src/contexts/dashboard/server/dashboard.ts:14-15` and `src/contexts/dashboard/server/portal-analytics.ts:18-19`
- **Quote** (dashboard.ts):
  ```ts
  import { isDashboardError } from '../domain/errors'
  import type { DashboardErrorCode } from '../domain/errors'
  ```
- **Quote** (portal-analytics.ts):
  ```ts
  export type { PortalAnalyticsData } from '../domain/types'
  import { isDashboardError } from '../domain/errors'
  import type { DashboardErrorCode } from '../domain/errors'
  ```
- **Rule**: D15 / architecture conventions — public-api.ts exists specifically so external consumers (server/) avoid importing domain directly. `staff-dashboard.ts` correctly imports from `public-api`; the other two files bypass it.
- **Fix**: Change `dashboard.ts` and `portal-analytics.ts` to import error types from `../application/public-api` (matching the pattern in `staff-dashboard.ts`). Also move the `PortalAnalyticsData` re-export in `portal-analytics.ts` to come from `public-api` rather than `domain/types`.

---

### [D12] MINOR CONTEXT.md use-case table formatting is misaligned for rows 2 and 3

- **File**: `src/contexts/dashboard/CONTEXT.md:66-69`
- **Quote**:
  ```
  | `getDashboardData` | organizationId, propertyId, portalId?, startDate, endDate | `DashboardData`                                           | Orchestrates all repo queries in parallel; engagement funnel + portal-scoped KPIs when portal set |
  |                    | `getPortalAnalytics`                                      | organizationId, propertyId, portalId, startDate, endDate  | `PortalAnalyticsData`                                                                             | Portal-scoped analytics: KPIs, funnel, rating distribution, rating trend. No review/reply data. |
  |                    | `getStaffDashboardData`                                   | organizationId, userId, propertyId, portalIds?, timeRange | `StaffDashboardData`                                                                              | Staff-scoped dashboard aggregation filtered to assigned portals.                                |
  ```
- **Rule**: D12 — CONTEXT.md must be accurate. The table columns are misaligned: rows 2-3 have `getPortalAnalytics` / `getStaffDashboardData` in the "Input" column instead of the "Use case" column. Also the Input column shows `portalIds?` but the actual input type has `portalId?: PortalId` (singular, optional).
- **Fix**: Fix table so each use case name is in the first column. Change `portalIds?` to `portalId?` to match the actual `GetStaffDashboardDataInput` type.

---

### [D4] MINOR Build function does not expose `publicApi` as a typed subset — return shape duplicates type references

- **File**: `src/contexts/dashboard/build.ts:22-35`
- **Quote**:
  ```ts
  export type DashboardContextApi = Readonly<{
    publicApi: Readonly<{
      getDashboardData: ReturnType<typeof getDashboardData>
      getPortalAnalytics: ReturnType<typeof getPortalAnalytics>
      getStaffDashboardData: ReturnType<typeof getStaffDashboardData>
    }>
    internal: Readonly<{
      repos: Readonly<{ dashboardRepo: ReturnType<typeof createDashboardRepository> }>
      useCases: Readonly<{
        getDashboardData: ReturnType<typeof getDashboardData>
        getPortalAnalytics: ReturnType<typeof getPortalAnalytics>
        getStaffDashboardData: ReturnType<typeof getStaffDashboardData>
      }>
    }>
  }>
  ```
- **Rule**: D4 — Build function pattern. The same three `ReturnType<typeof ...>` entries appear in both `publicApi` and `internal.useCases`. This is not a bug, but the duplication means any new use case must be added in two places. Consider deriving `publicApi` from `internal.useCases` or extracting a shared `UseCases` type.
- **Fix**: Extract a `DashboardUseCases` type and use it in both `publicApi` and `internal.useCases`.

---

### [D12] MINOR CONTEXT.md Public API section claims exports that don't include `StaffDashboardData`

- **File**: `src/contexts/dashboard/CONTEXT.md:75`
- **Quote**:
  ```
  - Types: KPIValue, KPIs, RecentReview, DashboardReplyStatus, DashboardData, PortalKPIs, PortalAnalyticsData, StaffDashboardData
  ```
- **Rule**: D12 — CONTEXT.md must match code. Actual `public-api.ts` exports 7 types (no `StaffDashboardData`).
- **Fix**: Either add `StaffDashboardData` to `public-api.ts` or remove it from the CONTEXT.md list.

---

### [D3] NIT `timeRangeToDates` is duplicated in `portal-analytics.ts` server file

- **File**: `src/contexts/dashboard/server/portal-analytics.ts:38-49`
- **Quote**:
  ```ts
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
- **Rule**: D3 — Shared utilities should be in one place. The identical function exists in `application/utils.ts` and is used by `dashboard.ts` and `staff-dashboard.ts`. Only `portal-analytics.ts` has a local copy.
- **Fix**: Remove local `timeRangeToDates` from `portal-analytics.ts` and import from `../application/utils` (matching the other two server files).

---

### [D3] NIT `MS_PER_DAY` constant duplicated in server file and utils

- **File**: `src/contexts/dashboard/server/portal-analytics.ts:36` and `src/contexts/dashboard/application/utils.ts:3`
- **Quote**: `const MS_PER_DAY = 86_400_000`
- **Rule**: D3 — Avoid magic constant duplication.
- **Fix**: Import `MS_PER_DAY` from `../application/utils` instead of redeclaring.
