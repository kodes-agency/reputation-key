// Portal analytics tab — KPI cards + charts for portal-scoped metrics

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { getPortalAnalyticsFn } from '#/contexts/dashboard/server/portal-analytics'
import {
  timeRangePreset,
  type TimeRangePreset,
} from '#/contexts/dashboard/application/dto/dashboard.dto'
import { isDarkCapabilityDenial } from '#/shared/auth/capability-denial'
import { TimeRangePicker } from './portal-analytics-time-range-picker'
import { BarChart3, MessageCircle, MousePointerClick, ScanLine } from 'lucide-react'
import {
  ChartCard,
  PortalRatingDistributionChart,
  RatingTrendChart,
} from './portal-analytics-charts'
import { EngagementFunnelChart } from './portal-analytics-funnel-chart'
import { PortalRatingCard } from './portal-rating-card'
import { PortalCountCard } from './portal-count-card'
import { PortalMetricEvidenceSummary } from './portal-metric-evidence-summary'
import { PortalResponseIntegritySummary } from './portal-response-integrity-summary'

type Props = Readonly<{
  portalId: string
  propertyId: string
  getPortalAnalytics: typeof getPortalAnalyticsFn
}>

// Intentionally global, not per-portal: the selected range is a user-level
// viewing preference that should follow the reader from portal to portal.
const TIME_RANGE_KEY = 'portal-analytics-time-range'

/** Stored preset, validated against the schema the server DTO uses. An
 * unchecked cast let any stale, hand-edited or since-removed value through to
 * getPortalAnalyticsFn, where it failed the DTO and pinned the tab on its error
 * branch until the reader happened to click another range. */
function readStoredTimeRange(): TimeRangePreset {
  if (typeof window === 'undefined') return 'all'
  try {
    const parsed = timeRangePreset.safeParse(localStorage.getItem(TIME_RANGE_KEY))
    return parsed.success ? parsed.data : 'all'
  } catch {
    return 'all'
  }
}

export function PortalAnalyticsTab({ portalId, propertyId, getPortalAnalytics }: Props) {
  const [timeRange, setTimeRange] = useState<TimeRangePreset>(readStoredTimeRange)

  useEffect(() => {
    try {
      localStorage.setItem(TIME_RANGE_KEY, timeRange)
    } catch {
      // Ignore storage errors (Safari private mode, sandboxed iframes): a
      // preference write must never take down the tab. Matches
      // portal-preview/use-preview-toggle.ts.
    }
  }, [timeRange])

  const {
    data,
    isLoading: loading,
    error: queryError,
  } = useQuery({
    queryKey: ['portal-analytics', propertyId, portalId, timeRange],
    queryFn: () => getPortalAnalytics({ data: { propertyId, portalId, timeRange } }),
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Loading analytics…</p>
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
          <h3 className="mt-4 font-semibold">Analytics isn't available yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Portal analytics aren't switched on for this property.
          </p>
        </div>
      )
    }
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm text-destructive">
          Couldn't load analytics. Please try again.
        </p>
      </div>
    )
  }

  if (!data) return null
  const propertyTimezone = data.period.timezone

  const hasData =
    (data.kpis.scans.value ?? 0) > 0 ||
    (data.kpis.feedback.value ?? 0) > 0 ||
    (data.kpis.reviewLinkClicks.value ?? 0) > 0 ||
    data.kpis.avgRating.sampleCount > 0 ||
    data.responseIntegrity.total > 0
  const hasPendingState = [
    data.kpis.scans.evidence.state,
    data.kpis.avgRating.evidence.state,
    data.kpis.feedback.evidence.state,
    data.kpis.reviewLinkClicks.evidence.state,
  ].some((state) => state === 'updating' || state === 'temporarily_unavailable')
  const engagementFunnel = data.engagementFunnel

  if (!hasData && !hasPendingState) {
    return (
      <div className="space-y-6">
        <TimeRangePicker
          timeRange={timeRange}
          onChange={(v) => setTimeRange(v as TimeRangePreset)}
        />
        <div className="rounded-lg border border-dashed p-12 text-center">
          <BarChart3 className="mx-auto size-10 text-muted-foreground/50" />
          <h3 className="mt-4 font-semibold">No data yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Share your portal to start collecting metrics.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <TimeRangePicker
        timeRange={timeRange}
        onChange={(v) => setTimeRange(v as TimeRangePreset)}
      />
      {/* The All Time range has no prior window. Cards render that missing
          comparison as an em dash instead of fabricating a 0% trend. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <PortalCountCard
          label="Scans"
          kpi={data.kpis.scans}
          icon={ScanLine}
          timeZone={propertyTimezone}
        />
        <PortalRatingCard
          rating={data.kpis.avgRating}
          timeRange={timeRange}
          timeZone={propertyTimezone}
        />
        <PortalCountCard
          label="Feedback"
          kpi={data.kpis.feedback}
          icon={MessageCircle}
          timeZone={propertyTimezone}
        />
        <PortalCountCard
          label="Review Clicks"
          kpi={data.kpis.reviewLinkClicks}
          icon={MousePointerClick}
          timeZone={propertyTimezone}
        />
      </div>
      <PortalMetricEvidenceSummary
        entries={[
          { label: 'Scans', evidence: data.kpis.scans.evidence },
          { label: 'Private ratings', evidence: data.kpis.avgRating.evidence },
          { label: 'Private feedback', evidence: data.kpis.feedback.evidence },
          { label: 'Review clicks', evidence: data.kpis.reviewLinkClicks.evidence },
        ]}
        timeZone={propertyTimezone}
      />
      <PortalResponseIntegritySummary summary={data.responseIntegrity} />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {engagementFunnel !== null && (
          <ChartCard title="Engagement Funnel" className="md:col-span-2">
            {(headingId) => (
              <EngagementFunnelChart funnel={engagementFunnel} labelledBy={headingId} />
            )}
          </ChartCard>
        )}
        {data.kpis.avgRating.evidence.state === 'ready' && (
          <ChartCard title="Private rating distribution">
            {(headingId) => (
              <PortalRatingDistributionChart
                distribution={data.ratingDistribution}
                labelledBy={headingId}
              />
            )}
          </ChartCard>
        )}
        {data.ratingTrend.length > 0 && (
          <ChartCard title="Private rating trend">
            {(headingId) => (
              <RatingTrendChart trend={data.ratingTrend} labelledBy={headingId} />
            )}
          </ChartCard>
        )}
      </div>
    </div>
  )
}
