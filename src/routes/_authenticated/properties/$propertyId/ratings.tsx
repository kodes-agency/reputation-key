import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod/v4'
import { getPropertyOverviewFn } from '#/contexts/reporting/server/dashboard'
import { PropertyRatingsPage } from '#/components/features/property/property-ratings-page'
import { dashboardKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { dashboardRangeSearch, type DashboardRange } from '#/shared/dashboard-range'

/**
 * The reporting read model is keyed by its own preset, of which `DashboardRange`
 * is a subset — so the shared range is the query key here with no conversion,
 * and Overview's own 30-day read stays a separate cache entry.
 */
const ratingsQuery = (propertyId: string, range: DashboardRange) =>
  queryOptions({
    queryKey: dashboardKeys.property({ propertyId, timeRange: range }),
    queryFn: () => getPropertyOverviewFn({ data: { propertyId, timeRange: range } }),
    staleTime: 60_000,
  })

export const Route = createFileRoute('/_authenticated/properties/$propertyId/ratings')({
  validateSearch: z.object({ range: dashboardRangeSearch }),
  staleTime: 60_000,
  loaderDeps: ({ search }) => ({ range: search.range }),
  loader: async ({ params: { propertyId }, deps: { range }, context }) => {
    await context.queryClient.ensureQueryData(ratingsQuery(propertyId, range))
  },
  component: PropertyRatingsRoute,
})

function PropertyRatingsRoute() {
  const { propertyId } = Route.useParams()
  const { range } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: overview } = useSuspenseQuery(ratingsQuery(propertyId, range))

  const onRangeChange = (value: DashboardRange) => {
    void navigate({ search: (previous) => ({ ...previous, range: value }) })
  }

  return (
    <PropertyRatingsPage
      property={propData.property}
      dashboard={overview.dashboard}
      range={range}
      onRangeChange={onRangeChange}
    />
  )
}
