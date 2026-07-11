import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod/v4'
import { getDashboardDataFn } from '#/contexts/dashboard/server/dashboard'
import { getAttentionSignalsFn } from '#/contexts/dashboard/server/attention-signals'
import { PropertyDashboard } from '#/components/features/property/property-dashboard'
import { dashboardKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/shared/queries/route-queries'
import type { TimeRangePreset } from '#/contexts/dashboard/application/dto/dashboard.dto'

const timeRangeSearch = z.object({
  timeRange: z.enum(['7d', '30d', '60d', '90d', 'all']).default('all'),
})

const dashboardQuery = (propertyId: string, timeRange: TimeRangePreset) =>
  queryOptions({
    queryKey: dashboardKeys.property({ propertyId, timeRange }),
    queryFn: () => getDashboardDataFn({ data: { propertyId, timeRange } }),
    staleTime: 60_000,
  })

const signalsQuery = (propertyId: string, timeRange: TimeRangePreset) =>
  queryOptions({
    queryKey: dashboardKeys.signals({ propertyId, timeRange }),
    queryFn: () => getAttentionSignalsFn({ data: { propertyId, timeRange } }),
    staleTime: 60_000,
  })

export const Route = createFileRoute('/_authenticated/properties/$propertyId/')({
  validateSearch: timeRangeSearch,
  staleTime: 60_000,
  loaderDeps: ({ search }) => ({ timeRange: search.timeRange }),
  loader: async ({ params: { propertyId }, deps: { timeRange }, context }) => {
    const [dashboard, signals] = await Promise.all([
      context.queryClient.ensureQueryData(dashboardQuery(propertyId, timeRange)),
      context.queryClient.ensureQueryData(signalsQuery(propertyId, timeRange)),
    ])
    return { dashboard, signals }
  },
  component: PropertyDashboardRoute,
})

function PropertyDashboardRoute() {
  const { propertyId } = Route.useParams()
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const property = propData.property
  const { timeRange } = Route.useSearch()
  const { data: dashboard } = useSuspenseQuery(dashboardQuery(propertyId, timeRange))
  const { data: signals } = useSuspenseQuery(signalsQuery(propertyId, timeRange))
  const navigate = Route.useNavigate()

  const onTimeRangeChange = (value: TimeRangePreset) => {
    navigate({ search: { timeRange: value } })
  }

  return (
    <PropertyDashboard
      property={property}
      dashboard={dashboard}
      signals={signals}
      propertyId={propertyId}
      timeRange={timeRange}
      onTimeRangeChange={onTimeRangeChange}
    />
  )
}
