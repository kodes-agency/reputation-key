import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod/v4'
import { getStaffDashboardDataFn } from '#/contexts/dashboard/server/staff-dashboard'
import { listStaffPortals } from '#/contexts/staff/server/staff-portals'
import { getStaffRecentActivity } from '#/contexts/review/server/staff-recent-activity'
import {
  staffHomeQueries,
  useStaffHomeData,
  type StaffHomeFns,
} from '#/components/features/staff/use-staff-home-data'
import { StaffHomeKpis } from '#/components/features/staff/staff-home-kpis'
import { StaffPortalFilter } from '#/components/features/staff/staff-portal-filter'
import { StaffRecentActivity } from '#/components/features/staff/staff-recent-activity'
import { StaffEmptyState } from '#/components/features/staff/staff-empty-state'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'

const homeSearch = z.object({
  propertyId: z.uuid().optional(),
  portalId: z.uuid().optional(),
})

/** Real server fns for the staff-home prop channel (loader + page hook). */
const staffHomeFns: StaffHomeFns = {
  getStaffDashboardData: getStaffDashboardDataFn,
  listStaffPortals,
  getStaffRecentActivity,
}

export const Route = createFileRoute('/_authenticated/home')({
  validateSearch: homeSearch,
  loaderDeps: ({ search }) => ({
    propertyId: search.propertyId,
    portalId: search.portalId,
  }),
  loader: async ({ context, deps: { propertyId, portalId } }) => {
    if (!propertyId) return

    const queries = staffHomeQueries(staffHomeFns, propertyId, portalId)
    await Promise.all([
      context.queryClient.ensureQueryData(queries.dashboard),
      context.queryClient.ensureQueryData(queries.portals),
      context.queryClient.ensureQueryData(queries.activity),
    ])
  },
  component: StaffHomePage,
})

function StaffHomePage() {
  const { propertyId: searchPropertyId, portalId: searchPortalId } = Route.useSearch()

  // BQC-6.8: with no property selected, render the no-property empty state
  // WITHOUT mounting the data hook — useStaffHomeData fires all four suspense
  // queries with propertyId='' otherwise, the fns' input validation throws
  // ("Property ID is required") and SSR aborts to client rendering. (The
  // suspense-query pattern can't be disabled, so the branch must happen
  // before the hook mounts — hence the split component.)
  if (!searchPropertyId) {
    return (
      <PageShell>
        <PageHeader title="Home" description="Your performance at a glance." />
        <StaffEmptyState />
      </PageShell>
    )
  }

  return <StaffHomeDataView propertyId={searchPropertyId} portalId={searchPortalId} />
}

function StaffHomeDataView({
  propertyId,
  portalId,
}: {
  propertyId: string
  portalId: string | undefined
}) {
  const { kpis, portals, recentReviews, emptyState } = useStaffHomeData(
    propertyId,
    portalId,
    staffHomeFns,
  )

  // Empty state (property selected but no assignments) — the decision lives
  // in the hook.
  if (emptyState) {
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
            activePortalId={portalId}
            searchPropertyId={propertyId}
          />
        }
      />

      {kpis && <StaffHomeKpis kpis={kpis} />}

      <StaffRecentActivity reviews={recentReviews} />
    </PageShell>
  )
}
