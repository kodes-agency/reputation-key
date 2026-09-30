import type { PortalAnalyticsData } from '#/contexts/reporting/server/portal-analytics'
import type { TimeRangePreset } from '#/contexts/reporting/application/dto/dashboard.dto'
import { TimeRangePicker } from '#/components/features/dashboard/time-range-picker'
import { BarChart3 } from 'lucide-react'
import { ChartCard, RatingTrendChart } from './portal-analytics-charts'
import { RatingDistributionChart } from '#/components/features/shared/rating-distribution-chart'
import { EngagementFunnelChart } from './portal-analytics-funnel-chart'
import { PortalKpiCards } from './portal-analytics-kpi-cards'
import { PortalMetricEvidenceSummary } from './portal-metric-evidence-summary'
import { PortalResponseIntegritySummary } from './portal-response-integrity-summary'
import { PortalLifetimeReconciliationSummary } from './portal-lifetime-reconciliation-summary'

type Props = Readonly<{
  data: PortalAnalyticsData
  timeRange: TimeRangePreset
  onTimeRangeChange: (timeRange: TimeRangePreset) => void
}>

export function PortalAnalyticsContent({ data, timeRange, onTimeRangeChange }: Props) {
  const propertyTimezone = data.period.timezone
  const hasData =
    (data.kpis.scans.value ?? 0) > 0 ||
    (data.kpis.feedback.value ?? 0) > 0 ||
    (data.kpis.googleOpens.value ?? 0) > 0 ||
    data.kpis.avgRating.sampleCount > 0 ||
    data.responseIntegrity.total > 0
  const hasPendingState = [
    data.kpis.scans.evidence.state,
    data.kpis.ratings.evidence.state,
    data.kpis.avgRating.evidence.state,
    data.kpis.feedback.evidence.state,
    data.kpis.googleOpens.evidence.state,
  ].some((state) => state === 'updating' || state === 'temporarily_unavailable')
  // Clicks exist but cannot be told apart: an empty page would be a false "no data".
  const hasWithheldGoogleOpens =
    data.kpis.googleOpens.evidence.availabilityReason === 'destination_unattributed'

  if (!hasData && !hasPendingState && !hasWithheldGoogleOpens) {
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
      <PortalKpiCards
        kpis={data.kpis}
        timeRange={timeRange}
        timeZone={propertyTimezone}
      />
      {data.lifetimeReconciliation === null && (
        <PortalMetricEvidenceSummary
          entries={[
            { label: 'Qualified scans', evidence: data.kpis.scans.evidence },
            { label: 'Private ratings', evidence: data.kpis.ratings.evidence },
            { label: 'Average private rating', evidence: data.kpis.avgRating.evidence },
            {
              label: 'Guests who opened Google',
              evidence: data.kpis.googleOpens.evidence,
            },
            { label: 'Private notes', evidence: data.kpis.feedback.evidence },
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
