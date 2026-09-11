import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod/v4'
import { getPropertyOverviewFn } from '#/contexts/reporting/server/dashboard'
import { getPropertyAiTrendFn } from '#/contexts/ai/server/property-trend'
import { getPropertyAiAggregatesFn } from '#/contexts/ai/server/property-aggregates'
import { PropertyDashboard } from '#/components/features/property/property-dashboard'
import { dashboardKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/routes/-queries/route-queries'
import {
  timeRangePreset,
  type TimeRangePreset,
} from '#/contexts/reporting/application/dto/dashboard.dto'

// `performanceRange` is gone: the Google report has its own page with the
// shared range (redesign rows 2, 6). A stale bookmark carrying it still loads —
// unknown search keys are ignored, not rejected.
const propertyDashboardSearch = z.object({
  timeRange: timeRangePreset.default('30d'),
})

const overviewQuery = (propertyId: string, timeRange: TimeRangePreset) =>
  queryOptions({
    queryKey: dashboardKeys.property({ propertyId, timeRange }),
    queryFn: () => getPropertyOverviewFn({ data: { propertyId, timeRange } }),
    staleTime: 60_000,
  })

export const Route = createFileRoute('/_authenticated/properties/$propertyId/')({
  validateSearch: propertyDashboardSearch,
  staleTime: 60_000,
  loaderDeps: ({ search }) => ({ timeRange: search.timeRange }),
  loader: async ({ params: { propertyId }, deps: { timeRange }, context }) => {
    await context.queryClient.ensureQueryData(overviewQuery(propertyId, timeRange))
  },
  component: PropertyDashboardRoute,
})

function PropertyDashboardRoute() {
  const { propertyId } = Route.useParams()
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const property = propData.property
  const { timeRange } = Route.useSearch()
  const { data: overview } = useSuspenseQuery(overviewQuery(propertyId, timeRange))
  const navigate = Route.useNavigate()

  const onTimeRangeChange = (value: TimeRangePreset) => {
    navigate({ search: (previous) => ({ ...previous, timeRange: value }) })
  }

  return (
    <PropertyDashboard
      property={property}
      dashboard={overview.dashboard}
      signals={overview.signals}
      propertyId={propertyId}
      timeRange={timeRange}
      onTimeRangeChange={onTimeRangeChange}
      getAiTrend={getPropertyAiTrendFn}
      getAiAggregates={getPropertyAiAggregatesFn}
    />
  )
}
