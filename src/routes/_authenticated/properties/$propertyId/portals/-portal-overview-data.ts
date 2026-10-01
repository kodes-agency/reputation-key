// The reads the Portals overview and a group's page share: every Portal of the
// Property, and the results over the window the reader chose. One definition of
// each, because both pages read the same cache entries. Queries only: a route's
// loader imports this file, so the hooks that draw the page live in
// `-portal-results-controls.ts` and stay out of the route's first download.
import { queryOptions } from '@tanstack/react-query'
import { listPortalOverview } from '#/contexts/portal/server/portals'
import { getPortalResultsOverviewFn } from '#/contexts/reporting/server/portal-results-overview'
import type { PortalResultsTimeRange } from '#/contexts/reporting/application/public-api'
import { portalKeys } from '#/shared/queries/query-keys'

// Read once for every Portal of the Property. A summary of state that changes in
// many places (publishing, codes, managers, groups), so it is refetched on
// arrival; the cached copy still renders first. Short, not zero: the loader has
// just fetched it, and a zero would read the same six sources a second time.
const OVERVIEW_STALE_MS = 5_000

export const portalOverviewQuery = (propertyId: string) =>
  queryOptions({
    queryKey: portalKeys.overview(propertyId),
    queryFn: () => listPortalOverview({ data: { propertyId } }),
    staleTime: OVERVIEW_STALE_MS,
  })

// The results beside the list: a separate read, so a slow or refused one never
// holds the list back. Always compared with the period before, as the strip says.
const RESULTS_STALE_MS = 30_000

export const portalResultsQuery = (
  propertyId: string,
  timeRange: PortalResultsTimeRange,
) =>
  queryOptions({
    queryKey: portalKeys.resultsOverview(propertyId, timeRange, true),
    queryFn: () =>
      getPortalResultsOverviewFn({ data: { propertyId, timeRange, compare: true } }),
    staleTime: RESULTS_STALE_MS,
  })
