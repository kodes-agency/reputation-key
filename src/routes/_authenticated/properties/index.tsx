// Properties — every property, side by side (docs/plan/property-list-table.md).
//
// Absorbs what `/dashboard` was for. The list itself comes from the parent
// layout's cached `propertiesQuery`; the comparison figures and setup progress
// are enrichments, each fetched with `useQuery` rather than the loader so a
// denial or an outage costs a column, not the page. A manager whose fleet read
// is gated (`dashboard.fleet_read`) still gets the management list they came for.
//
// Search, filter and sort live in the URL (`propertyListSearchSchema`), and the
// default view writes nothing there, so `/properties` stays bare.
import { useEffect } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import {
  infiniteQueryOptions,
  useInfiniteQuery,
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import {
  PropertyListPage,
  type PropertyComparison,
  type PropertySetupProgress,
} from '#/components/features/property/property-list-page'
import { propertyListSearchSchema } from '#/components/features/property/property-list-search-schema'
import type { DataState } from '#/components/features/property/property-list-view'
import {
  propertiesQuery,
  propertySetupSummariesQuery,
} from '#/routes/-queries/route-queries'
import { getFleetOverviewFn } from '#/contexts/reporting/server/fleet-overview'
import { dashboardKeys } from '#/shared/queries/query-keys'
import type { TimeRangePreset } from '#/contexts/reporting/application/dto/dashboard.dto'

/**
 * One unbounded read, not the identity/pulse pair Overview uses.
 *
 * A bounded fleet window counts governed metric readings by their `event_at`,
 * which is when the review was *recorded*; the per-property overview counts by
 * when the guest wrote it. On a freshly imported property those disagree
 * sharply — Hotel Elegance read "259 reviews in the last 30 days" here beside
 * "3 in the last 30 days" on its own Overview, because all 259 were ingested
 * today. Reconciling the two event-time semantics is a read-model decision, so
 * this list shows the figure both sources agree on and leaves the 30-day pulse
 * to the property's own page, where one basis is in force.
 */
const LIFETIME: TimeRangePreset = 'all'

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
    retry: false,
  })

export const Route = createFileRoute('/_authenticated/properties/')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    // Properties admin list is a manager surface (property.admin).
    if (!can(role, 'property.admin')) {
      throw redirect({ to: '/unavailable', search: { feature: 'Properties' } })
    }
  },
  validateSearch: (search) => propertyListSearchSchema.parse(search),
  component: PropertyListRoute,
})

function PropertyListRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data: propsData } = useSuspenseQuery(propertiesQuery)
  const fleet = useInfiniteQuery(fleetQuery(LIFETIME))
  const setupSummaries = useQuery(propertySetupSummariesQuery)

  // The fleet read pages by 50. Sorting by attention or rating is only honest
  // over every property, so read the rest before the order is applied.
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = fleet
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage])

  const fleetState: DataState =
    fleet.isError || isFetchNextPageError
      ? 'unavailable'
      : fleet.isPending || hasNextPage
        ? 'loading'
        : 'ready'
  const setupState: DataState = setupSummaries.isError
    ? 'unavailable'
    : setupSummaries.isPending
      ? 'loading'
      : 'ready'

  const comparison = new Map<string, PropertyComparison>()
  for (const page of fleet.data?.pages ?? []) {
    for (const entry of page.entries) {
      const signals = entry.attentionSignals
      comparison.set(entry.propertyId, {
        avgRating: entry.avgRating,
        reviewCount: entry.reviewCount,
        attention: {
          total: entry.totalAttention,
          overdue: signals.overdue,
          itemsToTriage: signals.itemsToTriage,
          escalated: signals.escalated,
          goalsBehindPace: signals.goalsBehindPace,
        },
      })
    }
  }

  const setup = setupSummaries.data
    ? new Map<string, PropertySetupProgress>(
        setupSummaries.data.map((entry) => [
          entry.propertyId,
          {
            completedCount: entry.completedCount,
            stepCount: entry.stepCount,
            nextStep: entry.nextStep,
          },
        ]),
      )
    : undefined

  return (
    <PropertyListPage
      properties={propsData.properties}
      comparison={comparison}
      fleet={fleetState}
      setup={setup}
      setupState={setupState}
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  )
}
