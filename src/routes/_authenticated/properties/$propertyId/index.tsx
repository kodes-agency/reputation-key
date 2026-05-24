import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { z } from 'zod/v4'
import { getDashboardDataFn } from '#/contexts/dashboard/server/dashboard'
import { PropertyDashboard } from '#/components/features/property/property-dashboard'
import type { TimeRangePreset } from '#/contexts/dashboard/application/dto/dashboard.dto'

const propertyRoute = getRouteApi('/_authenticated/properties/$propertyId')

const timeRangeSearch = z.object({
  timeRange: z.enum(['7d', '30d', '60d', '90d', 'all']).default('all'),
})

export const Route = createFileRoute('/_authenticated/properties/$propertyId/')({
  validateSearch: timeRangeSearch,
  staleTime: 60_000,
  loaderDeps: ({ search }) => ({ timeRange: search.timeRange }),
  loader: async ({ params: { propertyId }, deps: { timeRange } }) => {
    const dashboard = await getDashboardDataFn({ data: { propertyId, timeRange } })
    return { dashboard }
  },
  component: PropertyDashboardRoute,
})

function PropertyDashboardRoute() {
  const { property } = propertyRoute.useLoaderData()
  const { dashboard } = Route.useLoaderData()
  const { propertyId } = propertyRoute.useParams()
  const { timeRange } = Route.useSearch()
  const navigate = Route.useNavigate()

  const onTimeRangeChange = (value: TimeRangePreset) => {
    navigate({ search: { timeRange: value } })
  }

  return (
    <PropertyDashboard
      property={property}
      dashboard={dashboard}
      propertyId={propertyId}
      timeRange={timeRange}
      onTimeRangeChange={onTimeRangeChange}
    />
  )
}
