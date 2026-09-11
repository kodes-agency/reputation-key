import { createFileRoute, redirect } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod/v4'
import { PropertyInsightsReport } from '#/components/features/property/property-insights-report'
import { getPropertyInsightsFn } from '#/contexts/ai/server/property-insights'
import { propertyQuery } from '#/routes/-queries/route-queries'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { aiKeys } from '#/shared/queries/query-keys'
import {
  dashboardRangeSearch,
  toInsightsRange,
  type DashboardRange,
} from '#/shared/dashboard-range'

export const propertyGuestsSearchSchema = z.object({ range: dashboardRangeSearch })

export const propertyGuestsQuery = (propertyId: string, range: DashboardRange) =>
  queryOptions({
    queryKey: aiKeys.propertyInsights(propertyId, toInsightsRange(range)),
    queryFn: () =>
      getPropertyInsightsFn({ data: { propertyId, range: toInsightsRange(range) } }),
    staleTime: 60_000,
    // A capability denial is a permanent answer for this render, not a
    // transient fault: retrying would only delay the disabled state.
    retry: false,
  })

export const Route = createFileRoute('/_authenticated/properties/$propertyId/guests')({
  validateSearch: propertyGuestsSearchSchema,
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'dashboard.read')) throw redirect({ to: '/properties' })
  },
  staleTime: 60_000,
  loaderDeps: ({ search }) => ({ range: search.range }),
  loader: async ({ params: { propertyId }, deps: { range }, context }) => {
    await context.queryClient.ensureQueryData(propertyGuestsQuery(propertyId, range))
  },
  component: PropertyGuestsRoute,
})

function PropertyGuestsRoute() {
  const { propertyId } = Route.useParams()
  const { range } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data: propertyData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: result } = useSuspenseQuery(propertyGuestsQuery(propertyId, range))

  const onRangeChange = (value: DashboardRange) => {
    void navigate({ search: (previous) => ({ ...previous, range: value }) })
  }

  return (
    <PropertyInsightsReport
      propertyId={propertyId}
      propertyName={propertyData.property.name}
      range={range}
      onRangeChange={onRangeChange}
      result={result}
    />
  )
}
