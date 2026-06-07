import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { z } from 'zod/v4'
import { listStaffGoals } from '#/contexts/goal/server/staff-goals'
import { getStaffDashboardDataFn } from '#/contexts/dashboard/server/staff-dashboard'
import { listStaffPortals } from '#/contexts/staff/server/staff-portals'
import { getStaffRecentActivity } from '#/contexts/review/server/staff-recent-activity'
import { useStaffPropertyId } from '#/components/hooks/use-staff-property-id'
import { StaffHomeKpis } from '#/components/features/staff/staff-home-kpis'
import { StaffGoalSummary } from '#/components/features/staff/staff-goal-summary'
import { StaffPortalFilter } from '#/components/features/staff/staff-portal-filter'
import { StaffRecentActivity } from '#/components/features/staff/staff-recent-activity'
import { StaffEmptyState } from '#/components/features/staff/staff-empty-state'
import { PageShell } from '#/components/layout/page-shell'
import type { KPIs } from '#/contexts/dashboard/application/public-api'
import type { StaffGoalEntry } from '#/contexts/goal/server/staff-goals'
import type { StaffPortalEntry } from '#/contexts/staff/server/staff-portals'
import type { StaffRecentReview } from '#/contexts/review/server/staff-recent-activity'

const homeSearch = z.object({
  propertyId: z.string().uuid().optional(),
  portalId: z.string().uuid().optional(),
})

export const Route = createFileRoute('/_authenticated/home')({
  validateSearch: homeSearch,
  loaderDeps: ({ search }) => ({
    propertyId: search.propertyId,
    portalId: search.portalId,
  }),
  loader: async ({ deps: { propertyId, portalId } }) => {
    if (!propertyId) {
      return {
        goals: [] as StaffGoalEntry[],
        kpis: null as KPIs | null,
        portals: [] as StaffPortalEntry[],
        recentReviews: [] as StaffRecentReview[],
        hasAssignments: false,
      }
    }

    const [{ goals }, dashboard, { portals }, { reviews: recentReviews }] =
      await Promise.all([
        listStaffGoals({ data: { propertyId } }),
        getStaffDashboardDataFn({
          data: { propertyId, portalId, timeRange: '30d' },
        }),
        listStaffPortals({ data: { propertyId } }),
        getStaffRecentActivity({ data: { propertyId } }),
      ])

    return {
      goals,
      kpis: dashboard.kpis,
      portals,
      recentReviews,
      hasAssignments: dashboard.hasAssignments,
    }
  },
  component: StaffHomePage,
})

function StaffHomePage() {
  const { goals, kpis, portals, recentReviews, hasAssignments } = Route.useLoaderData()
  const { propertyId: searchPropertyId, portalId: searchPortalId } = Route.useSearch()
  const navigate = useNavigate()
  const localPropertyId = useStaffPropertyId()

  // Sync localStorage propertyId to URL search params
  useEffect(() => {
    if (localPropertyId && localPropertyId !== searchPropertyId) {
      navigate({
        to: '/home',
        search: { propertyId: localPropertyId, portalId: searchPortalId },
        replace: true,
      })
    }
  }, [localPropertyId, searchPropertyId, searchPortalId, navigate])

  // No property selected at all — show empty state
  if (!localPropertyId) {
    return (
      <PageShell>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Home</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your performance at a glance.
          </p>
        </div>
        <StaffEmptyState />
      </PageShell>
    )
  }

  // localStorage has a property but URL isn't synced yet — don't flash empty
  if (localPropertyId && !searchPropertyId) {
    return null
  }

  // Property is selected but staff has no assignments
  if (!hasAssignments && localPropertyId) {
    return (
      <PageShell>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Home</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your performance at a glance.
          </p>
        </div>
        <StaffEmptyState />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Home</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your performance at a glance.
          </p>
        </div>
        <StaffPortalFilter
          portals={portals}
          activePortalId={searchPortalId}
          searchPropertyId={searchPropertyId}
        />
      </div>

      {kpis && <StaffHomeKpis kpis={kpis} />}

      <StaffGoalSummary goals={goals} />

      <StaffRecentActivity reviews={recentReviews} />
    </PageShell>
  )
}
