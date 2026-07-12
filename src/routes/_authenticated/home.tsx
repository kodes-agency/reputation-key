import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod/v4'
import { listStaffGoals } from '#/contexts/goal/server/staff-goals'
import { getStaffVisibleBadges } from '#/contexts/badge/server/badges'
import { getStaffDashboardDataFn } from '#/contexts/dashboard/server/staff-dashboard'
import { listStaffPortals } from '#/contexts/staff/server/staff-portals'
import { getStaffRecentActivity } from '#/contexts/review/server/staff-recent-activity'
import {
  badgeKeys,
  dashboardKeys,
  goalKeys,
  reviewKeys,
  staffKeys,
} from '#/shared/queries/query-keys'
import { StaffHomeKpis } from '#/components/features/staff/staff-home-kpis'
import { StaffBadgeSummary } from '#/components/features/badges/staff-badge-summary'
import { StaffGoalSummary } from '#/components/features/staff/staff-goal-summary'
import { StaffPortalFilter } from '#/components/features/staff/staff-portal-filter'
import { StaffRecentActivity } from '#/components/features/staff/staff-recent-activity'
import { StaffEmptyState } from '#/components/features/staff/staff-empty-state'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import type { KPIs } from '#/contexts/dashboard/application/public-api'
import type { StaffGoalEntry } from '#/contexts/goal/application/public-api'
import type { StaffPortalEntry } from '#/contexts/staff/application/public-api'
import type { BadgeAwardWithTarget } from '#/contexts/badge/application/public-api'
import type { StaffRecentReview } from '#/contexts/review/application/public-api'

const homeSearch = z.object({
  propertyId: z.string().uuid().optional(),
  portalId: z.string().uuid().optional(),
})

const staffGoalsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: goalKeys.staff(propertyId),
    queryFn: () => listStaffGoals({ data: { propertyId } }),
    staleTime: 60 * 1000,
  })

const staffDashboardQuery = (propertyId: string, portalId: string | undefined) =>
  queryOptions({
    queryKey: dashboardKeys.staff({ propertyId, portalId }),
    queryFn: () =>
      getStaffDashboardDataFn({ data: { propertyId, portalId, timeRange: '30d' } }),
    staleTime: 60 * 1000,
  })

const staffPortalsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: staffKeys.portals(propertyId),
    queryFn: () => listStaffPortals({ data: { propertyId } }),
    staleTime: 60 * 1000,
  })

const staffActivityQuery = (propertyId: string) =>
  queryOptions({
    queryKey: reviewKeys.staffActivity(propertyId),
    queryFn: () => getStaffRecentActivity({ data: { propertyId } }),
    staleTime: 60 * 1000,
  })

const staffBadgesQuery = (propertyId: string) =>
  queryOptions({
    queryKey: badgeKeys.staffVisible(propertyId),
    queryFn: () => getStaffVisibleBadges({ data: { propertyId, limit: 6 } }),
    staleTime: 60 * 1000,
  })

export const Route = createFileRoute('/_authenticated/home')({
  validateSearch: homeSearch,
  loaderDeps: ({ search }) => ({
    propertyId: search.propertyId,
    portalId: search.portalId,
  }),
  loader: async ({ context, deps: { propertyId, portalId } }) => {
    if (!propertyId) {
      return {
        goals: [] as StaffGoalEntry[],
        kpis: null as KPIs | null,
        portals: [] as StaffPortalEntry[],
        recentReviews: [] as StaffRecentReview[],
        badges: [] as BadgeAwardWithTarget[],
        hasAssignments: false,
      }
    }

    const [{ goals }, dashboard, { portals }, { reviews: recentReviews }, badges] =
      await Promise.all([
        context.queryClient.ensureQueryData(staffGoalsQuery(propertyId)),
        context.queryClient.ensureQueryData(staffDashboardQuery(propertyId, portalId)),
        context.queryClient.ensureQueryData(staffPortalsQuery(propertyId)),
        context.queryClient.ensureQueryData(staffActivityQuery(propertyId)),
        context.queryClient.ensureQueryData(staffBadgesQuery(propertyId)),
      ])

    return {
      goals,
      kpis: dashboard.kpis,
      portals,
      recentReviews,
      badges: badges as BadgeAwardWithTarget[],
      hasAssignments: dashboard.hasAssignments,
    }
  },
  component: StaffHomePage,
})

function StaffHomePage() {
  const { propertyId: searchPropertyId, portalId: searchPortalId } = Route.useSearch()

  const { data: goalsData } = useSuspenseQuery({
    ...staffGoalsQuery(searchPropertyId ?? ''),
  })
  const { data: dashboardData } = useSuspenseQuery({
    ...staffDashboardQuery(searchPropertyId ?? '', searchPortalId),
  })
  const { data: portalsData } = useSuspenseQuery({
    ...staffPortalsQuery(searchPropertyId ?? ''),
  })
  const { data: activityData } = useSuspenseQuery({
    ...staffActivityQuery(searchPropertyId ?? ''),
  })
  const { data: badgesData } = useSuspenseQuery({
    ...staffBadgesQuery(searchPropertyId ?? ''),
  })

  const goals = goalsData?.goals ?? []
  const kpis = dashboardData?.kpis ?? null
  const portals = portalsData?.portals ?? []
  const recentReviews = activityData?.reviews ?? []
  const badges = (badgesData ?? []) as BadgeAwardWithTarget[]
  const hasAssignments = dashboardData?.hasAssignments ?? false
  // No property selected — the sidebar defaults ?propertyId= on first load; if
  // none ever appears the staff has no assignments, so show the empty state.
  if (!searchPropertyId) {
    return (
      <PageShell>
        <PageHeader title="Home" description="Your performance at a glance." />
        <StaffEmptyState />
      </PageShell>
    )
  }

  // Property is selected but staff has no assignments
  if (!hasAssignments) {
    return (
      <PageShell>
        <PageHeader title="Home" description="Your performance at a glance." />
        <StaffEmptyState />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <PageHeader
        title="Home"
        description="Your performance at a glance."
        actions={
          <StaffPortalFilter
            portals={portals}
            activePortalId={searchPortalId}
            searchPropertyId={searchPropertyId}
          />
        }
      />

      {kpis && <StaffHomeKpis kpis={kpis} />}

      <StaffBadgeSummary badges={badges} />

      <StaffGoalSummary goals={goals} />

      <StaffRecentActivity reviews={recentReviews} />
    </PageShell>
  )
}
