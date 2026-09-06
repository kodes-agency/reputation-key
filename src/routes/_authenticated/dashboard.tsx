// Dashboard — fleet overview (2+ properties), deep-dive redirect (1), empty (0).
// Fleet data is server-resolved (role-aware property enumeration) and cached via
// TanStack Query: the loader primes the cache (SSR), the component reads it.
// The 0/1/2+ render decision uses the parent layout loader's `properties` list.
import { createFileRoute, redirect } from '@tanstack/react-router'
import {
  infiniteQueryOptions,
  queryOptions,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { z } from 'zod/v4'
import { getFleetOverviewFn } from '#/contexts/dashboard/server/fleet-overview'
import { getSetupChecklistFn } from '#/contexts/dashboard/server/setup-checklist'
import type { SetupChecklist } from '#/contexts/dashboard/application/public-api'
import {
  timeRangePreset,
  type TimeRangePreset,
} from '#/contexts/dashboard/application/dto/dashboard.dto'
import { can } from '#/shared/domain/permissions'
import { dashboardKeys } from '#/shared/queries/query-keys'
import { propertiesQuery } from '#/routes/-queries/route-queries'
import type { AuthRouteContext } from '#/routes/_authenticated'
import {
  FleetOverview,
  FleetOverviewEmpty,
  FleetOverviewError,
  FleetOverviewLoading,
} from '#/components/features/dashboard/fleet-overview'
import {
  SetupChecklistLanding,
  SetupChecklistPanel,
} from '#/components/features/dashboard/setup-checklist'
import { TimeRangePicker } from '#/components/features/dashboard/time-range-picker'

// Shared query options — the loader (ensureInfiniteQueryData) and component
// (useSuspenseInfiniteQuery) reference the SAME options object so the primed
// cache is hit with zero extra fetch. This is the route-data Query pattern
// (routes/CONTEXT.md).
//
// Infinite, because the projection pages at FLEET_PAGE_SIZE = 50 and hands back
// an opaque cursor. This used to be a plain query that never passed one, so a
// fleet of more than fifty properties silently ended at fifty with nothing on
// screen to say so. The cursor is server-produced and opaque, so `pageParam`
// goes straight back — no client-side encoding, unlike the inbox list.
const setupChecklistQuery = queryOptions({
  queryKey: dashboardKeys.setup(),
  queryFn: () => getSetupChecklistFn(),
  staleTime: 30_000,
})
const fleetQuery = (timeRange: TimeRangePreset) =>
  infiniteQueryOptions({
    queryKey: dashboardKeys.fleet(timeRange),
    queryFn: ({ pageParam }) =>
      getFleetOverviewFn({
        data: { timeRange, ...(pageParam ? { cursor: pageParam } : {}) },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 60_000,
  })

export const Route = createFileRoute('/_authenticated/dashboard')({
  validateSearch: z.object({ timeRange: timeRangePreset.default('30d') }),
  beforeLoad: ({ context }) => {
    // Fleet dashboard is a manager surface (dashboard.fleet_read).
    // Lower-privilege roles have no dashboard surface in the beta.
    const { role } = context as AuthRouteContext
    if (!can(role, 'dashboard.fleet_read')) {
      throw redirect({ to: '/unavailable', search: { feature: 'Dashboard' } })
    }
  },
  loaderDeps: ({ search }) => ({ timeRange: search.timeRange }),
  loader: async ({ context, deps: { timeRange } }) => {
    const [{ properties }, checklist] = await Promise.all([
      context.queryClient.ensureQueryData(propertiesQuery),
      context.queryClient.ensureQueryData(setupChecklistQuery),
    ])
    if (properties.length === 1 && checklist.state === 'complete') {
      throw redirect({
        to: '/properties/$propertyId',
        params: { propertyId: properties[0].id },
      })
    }
    if (properties.length > 1) {
      await context.queryClient.ensureInfiniteQueryData(fleetQuery(timeRange))
    }
  },
  // Fleet data is operational; refresh on revisit or after invalidate().
  staleTime: 60_000,
  pendingComponent: FleetOverviewLoading,
  errorComponent: DashboardError,
  component: DashboardRoute,
})

function DashboardError({ error }: { error: Error }) {
  return <FleetOverviewError message={error.message} />
}

function DashboardRoute() {
  const { data: propsData } = useSuspenseQuery(propertiesQuery)
  const { data: checklist } = useSuspenseQuery(setupChecklistQuery)
  const properties = propsData.properties

  if (properties.length === 0) {
    return <FleetOverviewEmpty setup={<SetupChecklistPanel checklist={checklist} />} />
  }
  if (properties.length === 1) {
    return <SetupChecklistLanding checklist={checklist} propertyId={properties[0].id} />
  }

  return <FleetDashboard checklist={checklist} />
}

function FleetDashboard({
  checklist,
}: Readonly<{
  checklist: SetupChecklist
}>) {
  const { timeRange } = Route.useSearch()
  const navigate = Route.useNavigate()
  const fleet = useSuspenseInfiniteQuery(fleetQuery(timeRange))

  const pages = fleet.data.pages
  // Totals are org-wide and identical on every page — they come from the
  // projection summary, not from the page slice — so take them from the first.
  const data = {
    entries: pages.flatMap((page) => page.entries),
    totals: pages[0].totals,
    nextCursor: pages[pages.length - 1]?.nextCursor ?? null,
  }
  return (
    <>
      <TimeRangePicker
        timeRange={timeRange}
        onChange={(value) => {
          void navigate({ search: { timeRange: value } })
        }}
      />
      <FleetOverview
        data={data}
        setup={<SetupChecklistPanel checklist={checklist} />}
        isFetchingNextPage={fleet.isFetchingNextPage}
        onLoadMore={() => {
          void fleet.fetchNextPage()
        }}
      />
    </>
  )
}
