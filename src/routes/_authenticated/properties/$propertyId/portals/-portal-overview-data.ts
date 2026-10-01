// The reads the Portals overview and a group's page share: every Portal of the
// Property, and the results over the window the reader chose. One definition of
// each, because both pages read the same cache entries.
import { useMemo } from 'react'
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query'
import { listPortalOverview } from '#/contexts/portal/server/portals'
import { getPortalResultsOverviewFn } from '#/contexts/reporting/server/portal-results-overview'
import type { PortalResultsTimeRange } from '#/contexts/reporting/application/public-api'
import type { PortalOverviewResultsControls } from '#/components/features/portal/portal-overview/portal-overview-results-strip'
import {
  indexOverviewResults,
  resultsStateOf,
} from '#/components/features/portal/portal-overview/portal-overview-results'
import { useOverviewRange } from '#/components/features/portal/portal-overview/use-overview-range'
import { portalKeys } from '#/shared/queries/query-keys'
import { usePermissions } from '#/shared/hooks/usePermissions'

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

const portalResultsQuery = (propertyId: string, timeRange: PortalResultsTimeRange) =>
  queryOptions({
    queryKey: portalKeys.resultsOverview(propertyId, timeRange, true),
    queryFn: () =>
      getPortalResultsOverviewFn({ data: { propertyId, timeRange, compare: true } }),
    staleTime: RESULTS_STALE_MS,
  })

/**
 * What the page hands its results strip: the figures once read, the window and
 * how to change it. Undefined where the results are not shown to this reader
 * (`dashboard.read` is a different capability from the `portal.read` that got
 * them here, and a beta-dark posture or a Property too large for one read leaves
 * the page with its list alone).
 */
export function usePortalResultsControls(
  propertyId: string,
): PortalOverviewResultsControls | undefined {
  const { can: canDo } = usePermissions()
  const range = useOverviewRange()
  const query = useQuery({
    ...portalResultsQuery(propertyId, range.timeRange),
    enabled: range.ready && canDo('dashboard.read'),
    placeholderData: keepPreviousData,
    retry: false,
  })
  const data = query.data
  const index = useMemo(() => (data ? indexOverviewResults(data) : null), [data])
  const state = resultsStateOf(
    { allowed: canDo('dashboard.read'), error: query.error },
    index,
  )
  if (state.status === 'off') return undefined
  return {
    state,
    timeRange: range.timeRange,
    onTimeRangeChange: range.setTimeRange,
    onRetry: () => void query.refetch(),
    busy: query.isPlaceholderData,
  }
}
