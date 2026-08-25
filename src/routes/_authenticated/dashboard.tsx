// Dashboard — fleet overview (2+ properties), deep-dive redirect (1), empty (0).
// Fleet data is server-resolved (role-aware property enumeration) and cached via
// TanStack Query: the loader primes the cache (SSR), the component reads it.
// The 0/1/2+ render decision uses the parent layout loader's `properties` list.
import { useEffect } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import {
  infiniteQueryOptions,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { getFleetOverviewFn } from '#/contexts/dashboard/server/fleet-overview'
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
const FLEET_TIME_RANGE = '30d' as const
const fleetQuery = infiniteQueryOptions({
  queryKey: dashboardKeys.fleet(FLEET_TIME_RANGE),
  queryFn: ({ pageParam }) =>
    getFleetOverviewFn({
      data: { timeRange: FLEET_TIME_RANGE, ...(pageParam ? { cursor: pageParam } : {}) },
    }),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  staleTime: 60_000,
})

export const Route = createFileRoute('/_authenticated/dashboard')({
  beforeLoad: ({ context }) => {
    // Fleet dashboard is a manager surface (dashboard.fleet_read).
    // Staff have dashboard.read for their own staff dashboard, not the fleet view.
    const { role } = context as AuthRouteContext
    if (!can(role, 'dashboard.fleet_read')) throw redirect({ to: '/home' })
  },
  loader: async ({ context }) => {
    const { properties } = await context.queryClient.ensureQueryData(propertiesQuery)
    if (properties.length === 1) {
      throw redirect({
        to: '/properties/$propertyId',
        params: { propertyId: properties[0].id },
      })
    }
    if (properties.length > 1) {
      await context.queryClient.ensureInfiniteQueryData(fleetQuery)
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
  const properties = propsData.properties
  const navigate = useNavigate()

  // Single property → land directly on that property's deep-dive.
  useEffect(() => {
    if (properties.length === 1) {
      navigate({
        to: '/properties/$propertyId',
        params: { propertyId: properties[0].id },
        replace: true,
      })
    }
  }, [properties, navigate])

  if (properties.length === 0) return <FleetOverviewEmpty />
  if (properties.length === 1) return null

  return <FleetDashboard />
}

function FleetDashboard() {
  const fleet = useSuspenseInfiniteQuery(fleetQuery)

  const pages = fleet.data.pages
  // Totals are org-wide and identical on every page — they come from the
  // projection summary, not from the page slice — so take them from the first.
  const data = {
    entries: pages.flatMap((page) => page.entries),
    totals: pages[0].totals,
    nextCursor: pages[pages.length - 1]?.nextCursor ?? null,
  }
  return (
    <FleetOverview
      data={data}
      isFetchingNextPage={fleet.isFetchingNextPage}
      onLoadMore={() => {
        void fleet.fetchNextPage()
      }}
    />
  )
}
