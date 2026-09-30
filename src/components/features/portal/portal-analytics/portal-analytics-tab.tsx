// Portal Results tab — the range and the comparison are a viewing preference
// that follows the reader from portal to portal; the figures come from one
// server read per (range, comparison).

import { useState, useEffect } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { getPortalAnalyticsFn } from '#/contexts/reporting/server/portal-analytics'
import { portalKeys } from '#/shared/queries/query-keys'
import {
  timeRangePreset,
  type TimeRangePreset,
} from '#/contexts/reporting/application/dto/dashboard.dto'
import { isDarkCapabilityDenial } from '#/shared/auth/capability-denial'
import { BarChart3 } from 'lucide-react'
import { PortalAnalyticsContent } from './portal-analytics-content'

type Props = Readonly<{
  portalId: string
  propertyId: string
  getPortalAnalytics: typeof getPortalAnalyticsFn
}>

// Intentionally global, not per-portal: the selected range is a user-level
// viewing preference that should follow the reader from portal to portal.
const TIME_RANGE_KEY = 'portal-analytics-time-range'
const COMPARE_KEY = 'portal-analytics-compare'

/** Stored preset, validated against the schema the server DTO uses. An
 * unchecked cast let any stale, hand-edited or since-removed value through to
 * getPortalAnalyticsFn, where it failed the DTO and pinned the tab on its error
 * branch until the reader happened to click another range. */
function readStoredTimeRange(): TimeRangePreset {
  if (typeof window === 'undefined') return '30d'
  try {
    const parsed = timeRangePreset.safeParse(localStorage.getItem(TIME_RANGE_KEY))
    return parsed.success ? parsed.data : '30d'
  } catch {
    return '30d'
  }
}

/** Comparing is the default; only an explicit "off" is remembered as off. */
function readStoredCompare(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return localStorage.getItem(COMPARE_KEY) !== 'off'
  } catch {
    return true
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Ignore storage errors (Safari private mode, sandboxed iframes): a
    // preference write must never take down the tab. Matches
    // portal-preview/use-preview-toggle.ts.
  }
}

export function PortalAnalyticsTab({ portalId, propertyId, getPortalAnalytics }: Props) {
  const [timeRange, setTimeRange] = useState<TimeRangePreset>(readStoredTimeRange)
  const [compare, setCompare] = useState<boolean>(readStoredCompare)

  useEffect(() => remember(TIME_RANGE_KEY, timeRange), [timeRange])
  useEffect(() => remember(COMPARE_KEY, compare ? 'on' : 'off'), [compare])

  const {
    data,
    isLoading: loading,
    error: queryError,
  } = useQuery({
    queryKey: portalKeys.analytics(propertyId, portalId, timeRange, compare),
    queryFn: () =>
      getPortalAnalytics({ data: { propertyId, portalId, timeRange, compare } }),
    // Changing the range or the comparison keeps the page on screen while the
    // new figures load, instead of blanking it.
    placeholderData: keepPreviousData,
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Loading results…</p>
      </div>
    )
  }

  // getPortalAnalyticsFn authorizes on `dashboard.read`, a different capability
  // from the `portal.read` that got the reader onto this page — so a deliberate
  // beta-dark posture surfaces here as a query error (BQC-6.7 / F-PEOPLE).
  // Degrade those to friendly copy and keep a generic message for real
  // failures: the raw `.message` was rendering deny reasons like
  // `org_not_allowlisted` at the reader, in destructive red.
  if (queryError) {
    if (isDarkCapabilityDenial(queryError)) {
      return (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <BarChart3 className="mx-auto size-10 text-muted-foreground/50" />
          <h3 className="mt-4 font-semibold">Results aren't available yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Portal results aren't switched on for this property.
          </p>
        </div>
      )
    }
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm text-destructive">
          Couldn't load results. Please try again.
        </p>
      </div>
    )
  }

  if (!data) return null
  return (
    <PortalAnalyticsContent
      data={data}
      timeRange={timeRange}
      onTimeRangeChange={setTimeRange}
      compare={compare}
      onCompareChange={setCompare}
    />
  )
}
