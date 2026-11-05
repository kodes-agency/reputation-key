// The Properties list enriches its cached property rows with fleet figures and
// setup summaries. The loader starts both reads together within LIST_GRACE_MS;
// failures leave the affected columns unavailable. These keys sit below
// dashboardKeys.fleets() and propertyKeys.setupSummaries() so the loader can
// discard unfinished server reads before hydration.
import { infiniteQueryOptions, type QueryClient } from '@tanstack/react-query'
import { getFleetOverviewFn } from '#/contexts/reporting/server/fleet-overview'
import { propertySetupSummariesQuery } from '#/routes/-queries/route-queries'
import { dashboardKeys } from '#/shared/queries/query-keys'

/** Google snapshots, stored goals and current operational attention, paged by name. */
export const fleetQuery = () =>
  infiniteQueryOptions({
    queryKey: dashboardKeys.fleet('all'),
    queryFn: ({ pageParam }) =>
      getFleetOverviewFn({
        data: pageParam ? { cursor: pageParam } : {},
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
    queryClient.prefetchInfiniteQuery(fleetQuery()),
    queryClient.prefetchQuery(propertySetupSummariesQuery),
  ])
}
