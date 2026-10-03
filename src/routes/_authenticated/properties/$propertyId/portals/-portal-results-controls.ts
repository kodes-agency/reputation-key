// What a Portals page hands its results strip: the figures once read, the window
// and how to change it. Kept apart from the queries (`-portal-overview-data.ts`),
// which a route's loader imports, so this hook and what it draws with stay in
// the page's own download.
import { useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { PortalOverviewResultsControls } from '#/components/features/portal/portal-overview/portal-overview-results-strip'
import {
  indexOverviewResults,
  resultsStateOf,
} from '#/components/features/portal/portal-overview/portal-overview-results'
import { useOverviewRange } from '#/components/features/portal/portal-overview/use-overview-range'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { portalResultsQuery } from './-portal-overview-data'
import { isRetrying } from '#/components/hooks/is-retrying'

/**
 * Undefined where the results are not shown to this reader
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
    { allowed: canDo('dashboard.read'), error: query.error, retrying: isRetrying(query) },
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
