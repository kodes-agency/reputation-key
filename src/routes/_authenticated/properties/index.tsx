// Properties — every property, side by side (redesign row 3).
//
// Absorbs what `/dashboard` was for. The list itself comes from the parent
// layout's cached `propertiesQuery`; the comparison figures and the setup
// checklist are enrichments, each fetched with `useQuery` rather than the
// loader so a denial or an outage costs a column, not the page. A manager whose
// fleet read is gated (`dashboard.fleet_read`) still gets the management list
// they came for.
import { createFileRoute, redirect } from '@tanstack/react-router'
import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import {
  PropertyListPage,
  type PropertyComparison,
} from '#/components/features/property/property-list-page'
import { propertiesQuery } from '#/routes/-queries/route-queries'
import { getFleetOverviewFn } from '#/contexts/reporting/server/fleet-overview'
import { getSetupChecklistFn } from '#/contexts/reporting/server/setup-checklist'
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

const setupChecklistQuery = queryOptions({
  queryKey: dashboardKeys.setup(),
  queryFn: () => getSetupChecklistFn(),
  staleTime: 30_000,
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
  component: PropertyListRoute,
})

function PropertyListRoute() {
  const { data: propsData } = useSuspenseQuery(propertiesQuery)
  const fleet = useInfiniteQuery(fleetQuery(LIFETIME))
  const checklist = useQuery(setupChecklistQuery)

  const comparison = new Map<string, PropertyComparison>()
  for (const page of fleet.data?.pages ?? []) {
    for (const entry of page.entries) {
      comparison.set(entry.propertyId, {
        avgRating: entry.avgRating,
        reviewCount: entry.reviewCount,
        totalAttention: entry.totalAttention,
      })
    }
  }

  return (
    <PropertyListPage
      properties={propsData.properties}
      comparison={comparison.size > 0 ? comparison : undefined}
      checklist={checklist.data}
    />
  )
}
