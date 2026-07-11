// Dashboard — fleet overview (2+ properties), deep-dive redirect (1), empty (0).
// Fleet data is server-resolved (role-aware property enumeration) and cached via
// TanStack Query: the loader primes the cache (SSR), the component reads it.
// The 0/1/2+ render decision uses the parent layout loader's `properties` list.
import { useEffect } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { getFleetOverviewFn } from '#/contexts/dashboard/server/fleet-overview'
import { can } from '#/shared/domain/permissions'
import { dashboardKeys } from '#/shared/queries/query-keys'
import { propertiesQuery } from '#/shared/queries/route-queries'
import type { AuthRouteContext } from '#/routes/_authenticated'
import {
  FleetOverview,
  FleetOverviewEmpty,
  FleetOverviewError,
  FleetOverviewLoading,
} from '#/components/features/dashboard/fleet-overview'

// Shared query options — the loader (ensureQueryData) and component
// (useSuspenseQuery) reference the SAME options object so the primed cache is
// hit with zero extra fetch. This is the route-data Query pattern (routes/CONTEXT.md).
const fleetQuery = queryOptions({
  queryKey: dashboardKeys.fleet(),
  queryFn: () => getFleetOverviewFn({ data: { timeRange: '30d' } }),
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
    const fleet = await context.queryClient.ensureQueryData(fleetQuery)
    return { fleet }
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
  const { data: fleet } = useSuspenseQuery(fleetQuery)
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
  return <FleetOverview data={fleet} />
}
