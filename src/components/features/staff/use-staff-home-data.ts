// useStaffHomeData — deep hook behind the staff home page.
//
// The page no longer knows: the three suspense queries (keys, staleTime, payload
// shapes), the per-query result shaping (?? defaults), or the empty-state
// decision (decideStaffHomeEmptyState). It receives one data bundle and renders.
//
// Server fns arrive via the fns prop channel (src/components/CONTEXT.md:55) —
// type-only server imports; the route passes the real fns, tests/stories pass
// in-memory ones.

import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import type { getStaffDashboardDataFn } from '#/contexts/dashboard/server/staff-dashboard'
import type { listStaffPortals } from '#/contexts/staff/server/staff-portals'
import type { getStaffRecentActivity } from '#/contexts/review/server/staff-recent-activity'
import { dashboardKeys, reviewKeys, staffKeys } from '#/shared/queries/query-keys'
import type { KPIs } from '#/contexts/dashboard/application/public-api'
import type { StaffPortalEntry } from '#/contexts/staff/application/public-api'
import type { StaffRecentReview } from '#/contexts/review/application/public-api'

export type StaffHomeFns = Readonly<{
  getStaffDashboardData: typeof getStaffDashboardDataFn
  listStaffPortals: typeof listStaffPortals
  getStaffRecentActivity: typeof getStaffRecentActivity
}>

export type StaffHomeEmptyState = 'no-property' | 'no-assignments' | null

export type StaffHomeData = Readonly<{
  kpis: KPIs | null
  portals: ReadonlyArray<StaffPortalEntry>
  recentReviews: ReadonlyArray<StaffRecentReview>
  hasAssignments: boolean
  emptyState: StaffHomeEmptyState
}>

// ── Empty-state decision table (pure) ───────────────────────────
//
//   propertyId   hasAssignments   → emptyState
//   falsy        —                → 'no-property'  (sidebar defaults ?propertyId=
//                                  on first load; none ever appearing means the
//                                  staff has no assignments)
//   defined      false            → 'no-assignments'
//   defined      true             → null

export function decideStaffHomeEmptyState(
  propertyId: string | undefined,
  hasAssignments: boolean,
): StaffHomeEmptyState {
  if (!propertyId) return 'no-property'
  if (!hasAssignments) return 'no-assignments'
  return null
}

// ── Query wiring ────────────────────────────────────────────────

/** The four staff-home suspense queries (shared by the route loader + the hook). */
export function staffHomeQueries(
  fns: StaffHomeFns,
  propertyId: string,
  portalId: string | undefined,
) {
  return {
    dashboard: queryOptions({
      queryKey: dashboardKeys.staff({ propertyId, portalId }),
      queryFn: () =>
        fns.getStaffDashboardData({ data: { propertyId, portalId, timeRange: '30d' } }),
      staleTime: 60 * 1000,
    }),
    portals: queryOptions({
      queryKey: staffKeys.portals(propertyId),
      queryFn: () => fns.listStaffPortals({ data: { propertyId } }),
      staleTime: 60 * 1000,
    }),
    activity: queryOptions({
      queryKey: reviewKeys.staffActivity(propertyId),
      queryFn: () => fns.getStaffRecentActivity({ data: { propertyId } }),
      staleTime: 60 * 1000,
    }),
  } as const
}

// ── The hook ────────────────────────────────────────────────────

export function useStaffHomeData(
  propertyId: string | undefined,
  portalId: string | undefined,
  fns: StaffHomeFns,
): StaffHomeData {
  const queries = staffHomeQueries(fns, propertyId ?? '', portalId)
  const { data: dashboardData } = useSuspenseQuery(queries.dashboard)
  const { data: portalsData } = useSuspenseQuery(queries.portals)
  const { data: activityData } = useSuspenseQuery(queries.activity)

  const hasAssignments = dashboardData?.hasAssignments ?? false
  return {
    kpis: dashboardData?.kpis ?? null,
    portals: portalsData?.portals ?? [],
    recentReviews: activityData?.reviews ?? [],
    hasAssignments,
    emptyState: decideStaffHomeEmptyState(propertyId, hasAssignments),
  }
}
