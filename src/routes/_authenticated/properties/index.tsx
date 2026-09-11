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
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { useInfiniteQuery } from '@tanstack/react-query'
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
 * Two windows, as on Overview (row 5): the rating a manager recognises is
 * all-time, the review count worth comparing is recent. Both are entries of one
 * read model, and the figures are read from whichever page arrives — the
 * projection pages at fifty, so a fleet larger than that fills in as pages
 * load rather than silently ending.
 */
const LIFETIME: TimeRangePreset = 'all'
const PULSE: TimeRangePreset = '30d'

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
    if (!can(role, 'property.admin'))
      throw redirect({ to: '/unavailable', search: { feature: 'Properties' } })
  },
  component: PropertyListRoute,
})

function PropertyListRoute() {
  const { data: propsData } = useSuspenseQuery(propertiesQuery)
  const lifetime = useInfiniteQuery(fleetQuery(LIFETIME))
  const pulse = useInfiniteQuery(fleetQuery(PULSE))
  const checklist = useQuery(setupChecklistQuery)

  const comparison = new Map<string, PropertyComparison>()
  for (const page of lifetime.data?.pages ?? []) {
    for (const entry of page.entries) {
      comparison.set(entry.propertyId, {
        avgRating: entry.avgRating,
        recentReviewCount: 0,
        totalAttention: entry.totalAttention,
      })
    }
  }
  for (const page of pulse.data?.pages ?? []) {
    for (const entry of page.entries) {
      const existing = comparison.get(entry.propertyId)
      comparison.set(entry.propertyId, {
        // Attention is a standing count, so either read carries it; the recent
        // read is the one to trust for a rating drop within the window.
        avgRating: existing?.avgRating ?? null,
        recentReviewCount: entry.reviewCount,
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
