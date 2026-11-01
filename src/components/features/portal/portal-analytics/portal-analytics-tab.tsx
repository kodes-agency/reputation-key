import type { PortalPublicationState } from '../shared/types'
// Portal Results tab — the range is a viewing preference
// that follows the reader from portal to portal; the figures come from one
// server read per range, always compared with the period before. Above them, the Monthly portal goal's
// line when the route hands one in; the tab keeps its loading state while that
// line is read, so the line never pushes the figures down once they are drawn.

import { useState, useEffect, type ReactNode } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { getPortalAnalyticsFn } from '#/contexts/reporting/server/portal-analytics'
import { portalKeys } from '#/shared/queries/query-keys'
import type { TimeRangePreset } from '#/contexts/reporting/application/dto/dashboard.dto'
import { isDarkCapabilityDenial } from '#/shared/auth/capability-denial'
import { BarChart3 } from 'lucide-react'
import { EmptyState } from '#/components/ui/empty-state'
import { RegionError } from '#/components/ui/region-error'
import { PortalAnalyticsContent } from './portal-analytics-content'
import { PortalResultsLoading } from './portal-results-loading'
import {
  PORTAL_RESULTS_RANGE_STORAGE_KEY,
  storedResultsRange,
} from './portal-results-window'
import { hasFailed, isRetrying } from '#/components/hooks/is-retrying'
import { usePermissions } from '#/shared/hooks/usePermissions'

type Props = Readonly<{
  portalId: string
  propertyId: string
  getPortalAnalytics: typeof getPortalAnalyticsFn
  /**
   * Guests can open the portal now. Left out, it is taken to be live; a portal
   * that is not has nothing to count, and its empty state says to publish.
   */
  publicationState?: PortalPublicationState
  pageIsLive?: boolean
  skipPrivateRating?: boolean
  /**
   * The live code's scans are counted. Left out, they are taken to be; a code
   * that predates scan counting has its scans shown as a dash with the reason.
   */
  scansCounted?: boolean
  /** The Monthly portal goal's line, above everything the tab shows. */
  goalLine?: ReactNode
  /** The line is still being read: the tab shows its loading state until it is. */
  goalLinePending?: boolean
}>

// Intentionally global, not per-portal: the selected range is a user-level
// viewing preference that should follow the reader from portal to portal.
const TIME_RANGE_KEY = PORTAL_RESULTS_RANGE_STORAGE_KEY

/** Stored preset, validated against the schema the server DTO uses and against
 * the ranges this tab offers. An unchecked cast let any stale, hand-edited or
 * since-removed value through to getPortalAnalyticsFn, where it failed the DTO
 * and pinned the tab on its error branch until the reader happened to click
 * another range. */
function readStoredTimeRange(): TimeRangePreset {
  if (typeof window === 'undefined') return '30d'
  try {
    return storedResultsRange(localStorage.getItem(TIME_RANGE_KEY))
  } catch {
    return '30d'
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Ignore storage errors (Safari private mode, sandboxed iframes): a
    // preference write must never take down the tab.
  }
}

export function PortalAnalyticsTab({
  goalLine,
  goalLinePending = false,
  ...props
}: Props) {
  if (goalLine === undefined && !goalLinePending) return <ResultsBody {...props} />
  return (
    <div className="space-y-8">
      {goalLinePending ? null : goalLine}
      <ResultsBody {...props} holding={goalLinePending} />
    </div>
  )
}

function ResultsBody({
  portalId,
  propertyId,
  getPortalAnalytics,
  pageIsLive = true,
  skipPrivateRating = false,
  publicationState,
  scansCounted = true,
  holding = false,
}: Omit<Props, 'goalLine' | 'goalLinePending'> & Readonly<{ holding?: boolean }>) {
  const { can } = usePermissions()
  const [timeRange, setTimeRange] = useState<TimeRangePreset>(readStoredTimeRange)

  useEffect(() => remember(TIME_RANGE_KEY, timeRange), [timeRange])

  const query = useQuery({
    queryKey: portalKeys.analytics(propertyId, portalId, timeRange, true),
    queryFn: () =>
      getPortalAnalytics({ data: { propertyId, portalId, timeRange, compare: true } }),
    // Changing the range keeps the page on screen while the
    // new figures load, instead of blanking it.
    placeholderData: keepPreviousData,
  })
  const { data, isLoading: loading, error: queryError, isPlaceholderData: stale } = query

  // A failed read comes before loading: a retry resets a query with no data to
  // pending, and the panel must stay, its button busy, rather than give way to the
  // skeleton and drop focus.
  const failed = hasFailed(query)
  if ((loading || holding) && !failed) return <PortalResultsLoading />

  // getPortalAnalyticsFn authorizes on `dashboard.read`, a different capability
  // from the `portal.read` that got the reader onto this page — so a deliberate
  // beta-dark posture surfaces here as a query error (BQC-6.7 / F-PEOPLE).
  // Degrade those to friendly copy and keep a generic message for real
  // failures: the raw `.message` was rendering deny reasons like
  // `org_not_allowlisted` at the reader, in destructive red.
  if (failed) {
    if (isDarkCapabilityDenial(queryError)) {
      return (
        <EmptyState
          icon={BarChart3}
          title="Results aren’t available yet"
          description="Portal results aren’t switched on for this property."
        />
      )
    }
    return (
      <RegionError
        message="Results couldn’t be loaded."
        onRetry={() => void query.refetch()}
        retrying={isRetrying(query)}
      />
    )
  }

  if (!data) return null
  return (
    <PortalAnalyticsContent
      data={data}
      timeRange={timeRange}
      onTimeRangeChange={setTimeRange}
      busy={stale}
      place={{
        propertyId,
        portalId,
        isLive: pageIsLive,
        skipPrivateRating,
        publicationState,
        scansCounted,
        // The link opens the manager Inbox, whose route refuses anyone without this.
        canOpenInbox: can('inbox.manage'),
      }}
    />
  )
}
