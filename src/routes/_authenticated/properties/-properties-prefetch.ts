// What the Properties list reads beside the list itself, and the loader's
// priming of it.
//
// The list comes from the layout's cached `propertiesQuery`; the comparison
// figures (the fleet read) and the setup progress arrive from two more reads.
// They were started only after hydration, so the first paint had a row of grey
// bars that grew when the figures came (63 to 79 px a row) and a list that
// re-sorted itself once the attention figure was known (a 158 px reorder), the
// largest cold layout shift of any page (0.091). The loader now starts both and
// holds the page for them at most `LIST_GRACE_MS`, the way Overview holds for
// its goals: usually they are in, and the first paint is the finished list; a
// slow one follows on its own and never holds the page.
import { infiniteQueryOptions, type QueryClient } from '@tanstack/react-query'
import { getFleetOverviewFn } from '#/contexts/reporting/server/fleet-overview'
import type { TimeRangePreset } from '#/contexts/reporting/application/dto/dashboard.dto'
import { propertySetupSummariesQuery } from '#/routes/-queries/route-queries'
import { dashboardKeys } from '#/shared/queries/query-keys'

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
 * to the property's own page, where one basis is in force. The Rating and
 * Reviews columns are Google's own number and count (decision 16), which the
 * same read carries.
 */
export const LIFETIME: TimeRangePreset = 'all'

export const fleetQuery = (timeRange: TimeRangePreset) =>
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

/**
 * Starts the fleet read (its first page; the page reads the rest) and the setup
 * summaries together. Settles once both have, whichever way: a denied or failed
 * read leaves its columns unavailable on the page, as before, never the page in
 * an error.
 */
export async function prefetchPropertyList(queryClient: QueryClient): Promise<void> {
  await Promise.allSettled([
    queryClient.prefetchInfiniteQuery(fleetQuery(LIFETIME)),
    queryClient.prefetchQuery(propertySetupSummariesQuery),
  ])
}
