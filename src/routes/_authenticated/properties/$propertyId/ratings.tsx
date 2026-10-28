import { createFileRoute } from '@tanstack/react-router'
import {
  keepPreviousData,
  queryOptions,
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { z } from 'zod/v4'
import { getPropertyOverviewFn } from '#/contexts/reporting/server/dashboard'
import { PropertyRatingsPage } from '#/components/features/property/property-ratings-page'
import { dashboardKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { dashboardRangeSearch, type DashboardRange } from '#/shared/dashboard-range'
import { keptData, rangeOfLocation } from './-dashboard-range-read'

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
  staticData: { page: { title: 'Ratings', tier: 'dashboard', under: 'property' } },
  validateSearch: z.object({ range: dashboardRangeSearch }),
  staleTime: 60_000,
  // The range is not a loader dependency (`-dashboard-range-read.ts`): the loader
  // primes the one the URL names when the page is entered, and the page reads the
  // rest through the cache, so choosing a range never swaps the page for its
  // skeleton.
  loader: async ({ params: { propertyId }, location, context }) => {
    await context.queryClient.ensureQueryData(
      ratingsQuery(propertyId, rangeOfLocation(location)),
    )
  },
  component: PropertyRatingsRoute,
})

function PropertyRatingsRoute() {
  const { propertyId } = Route.useParams()
  const { range } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const reading = useQuery({
    ...ratingsQuery(propertyId, range),
    placeholderData: keepPreviousData,
  })
  const overview = keptData(reading)

  const onRangeChange = (value: DashboardRange) => {
    // A window on the page, not a place: replace, so arrowing through the
    // segments (a radio group chooses on focus) is no history entry per step.
    void navigate({
      search: (previous) => ({ ...previous, range: value }),
      replace: true,
    })
  }

  if (overview === null) return null

  return (
    <PropertyRatingsPage
      property={propData.property}
      dashboard={overview.dashboard}
      range={range}
      onRangeChange={onRangeChange}
      busy={reading.isPlaceholderData}
    />
  )
}
