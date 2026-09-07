import type { PortalAnalyticsData } from '#/contexts/reporting/server/portal-analytics'
import type { TimeRangePreset } from '#/contexts/reporting/application/dto/dashboard.dto'
import { TimeRangePicker } from '#/components/features/dashboard/time-range-picker'
import { BarChart3 } from 'lucide-react'
import { ChartCard, RatingTrendChart } from './portal-analytics-charts'
import { RatingDistributionChart } from '#/components/features/shared/rating-distribution-chart'
import { EngagementFunnelChart } from './portal-analytics-funnel-chart'
import { StatCard } from '#/components/features/shared/stat-card'
import { ratingPresentation } from '#/components/features/dashboard/rating-presentation'
import { PortalMetricEvidenceSummary } from './portal-metric-evidence-summary'
import { PortalResponseIntegritySummary } from './portal-response-integrity-summary'
import { PortalLifetimeReconciliationSummary } from './portal-lifetime-reconciliation-summary'

type Props = Readonly<{
  data: PortalAnalyticsData
  timeRange: TimeRangePreset
  onTimeRangeChange: (timeRange: TimeRangePreset) => void
}>

function trendHint(trend: number | null): string {
  if (trend === null) return '—'
  const direction = trend > 0 ? '↑' : trend < 0 ? '↓' : '—'
  return `${direction} ${Math.abs(trend)}%`
}

export function PortalAnalyticsContent({ data, timeRange, onTimeRangeChange }: Props) {
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

  if (!hasData && !hasPendingState) {
    return (
      <div className="space-y-6">
        <TimeRangePicker timeRange={timeRange} onChange={onTimeRangeChange} />
        {data.lifetimeReconciliation !== null && (
          <PortalLifetimeReconciliationSummary
            state={data.lifetimeReconciliation}
            timeZone={propertyTimezone}
          />
        )}
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

  const rating = ratingPresentation(data.kpis.avgRating, timeRange)
  const engagementFunnel = data.engagementFunnel
  return (
    <div className="space-y-8">
      <TimeRangePicker timeRange={timeRange} onChange={onTimeRangeChange} />
      {data.lifetimeReconciliation !== null && (
        <PortalLifetimeReconciliationSummary
          state={data.lifetimeReconciliation}
          timeZone={propertyTimezone}
        />
      )}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Scans"
          value={
            data.kpis.scans.value === null ? '—' : data.kpis.scans.value.toLocaleString()
          }
          hint={trendHint(data.kpis.scans.trend)}
          availability={{
            state: data.kpis.scans.evidence.state,
            dataThrough: data.kpis.scans.evidence.verifiedThrough,
            reason: data.kpis.scans.evidence.availabilityReason,
            timeZone: propertyTimezone,
          }}
        />
        <StatCard
          label="Private rating avg"
          value={rating.value}
          hint={
            <>
              <span>{rating.comparison}</span>
              {data.kpis.avgRating.evidence.state === 'ready' ? (
                <span className="block">{rating.evidence}</span>
              ) : null}
            </>
          }
          availability={{
            state: data.kpis.avgRating.evidence.state,
            dataThrough: data.kpis.avgRating.evidence.verifiedThrough,
            reason: data.kpis.avgRating.evidence.availabilityReason,
            timeZone: propertyTimezone,
          }}
        />
        <StatCard
          label="Feedback"
          value={
            data.kpis.feedback.value === null
              ? '—'
              : data.kpis.feedback.value.toLocaleString()
          }
          hint={trendHint(data.kpis.feedback.trend)}
          availability={{
            state: data.kpis.feedback.evidence.state,
            dataThrough: data.kpis.feedback.evidence.verifiedThrough,
            reason: data.kpis.feedback.evidence.availabilityReason,
            timeZone: propertyTimezone,
          }}
        />
        <StatCard
          label="Review Clicks"
          value={
            data.kpis.reviewLinkClicks.value === null
              ? '—'
              : data.kpis.reviewLinkClicks.value.toLocaleString()
          }
          hint={trendHint(data.kpis.reviewLinkClicks.trend)}
          availability={{
            state: data.kpis.reviewLinkClicks.evidence.state,
            dataThrough: data.kpis.reviewLinkClicks.evidence.verifiedThrough,
            reason: data.kpis.reviewLinkClicks.evidence.availabilityReason,
            timeZone: propertyTimezone,
          }}
        />
      </div>
      {data.lifetimeReconciliation === null && (
        <PortalMetricEvidenceSummary
          entries={[
            { label: 'Scans', evidence: data.kpis.scans.evidence },
            { label: 'Private ratings', evidence: data.kpis.avgRating.evidence },
            { label: 'Private feedback', evidence: data.kpis.feedback.evidence },
            { label: 'Review clicks', evidence: data.kpis.reviewLinkClicks.evidence },
          ]}
          timeZone={propertyTimezone}
        />
      )}
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
              <RatingDistributionChart
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
