// Dashboard → Ratings (redesign rows 7a, 8, 9, 10, 12–14).
import { useId } from 'react'
import type { DashboardData } from '#/contexts/reporting/application/public-api'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { NAV_LABEL } from '#/components/layout/nav-labels'
import { trailCrumbs } from '#/components/layout/page-identity'
import { DashboardRangeControl } from '#/components/features/dashboard/dashboard-range-control'
import { GlossaryTerm } from '#/components/features/shared/glossary-term'
import { RatingDistributionChart } from '#/components/features/shared/rating-distribution-chart'
import {
  dashboardRangeComparisonLabel,
  DASHBOARD_RANGE_LABELS,
  type DashboardRange,
} from '#/shared/dashboard-range'
import { PropertyReputationTrendChart } from './property-reputation-trend-chart'
import { formatNumber } from '#/lib/format'
import { MetricDelta } from '#/components/ui/metric-delta'
import { Metric, MetricStrip, MetricValue } from '#/components/ui/metric-strip'
import { RatingFigure } from '#/components/ui/rating-figure'

export interface PropertyRatingsPageProps {
  property: Readonly<{ id: string; name: string }>
  dashboard: DashboardData
  range: DashboardRange
  onRangeChange: (range: DashboardRange) => void
}

function formatReplyTime(hours: number): string {
  if (hours < 1) return 'Less than 1 hour'
  if (hours < 24) {
    const rounded = Math.round(hours * 10) / 10
    return `${formatNumber(rounded)} ${rounded === 1 ? 'hour' : 'hours'}`
  }
  const days = Math.round((hours / 24) * 10) / 10
  return `${formatNumber(days)} ${days === 1 ? 'day' : 'days'}`
}

export function PropertyRatingsPage({
  property,
  dashboard,
  range,
  onRangeChange,
}: PropertyRatingsPageProps) {
  const distributionHeadingId = useId()
  const { kpis, ratingDistribution, ratingTrend, reviewVolume, replyPerformance } =
    dashboard
  const comparisonLabel = dashboardRangeComparisonLabel(range)
  const hasReviews = kpis.reviews.value > 0

  const ratingContext =
    kpis.avgRating.value === null ? (
      'No ratings in this period.'
    ) : comparisonLabel === null ? null : kpis.avgRating.comparison === null ? (
      'Needs 10 ratings in each period to compare.'
    ) : (
      <MetricDelta value={kpis.avgRating.comparison} comparisonLabel={comparisonLabel} />
    )

  const reviewContext =
    comparisonLabel === null ? null : kpis.reviews.trend === null ? (
      `No reviews in the previous ${DASHBOARD_RANGE_LABELS[range].toLowerCase()} to compare.`
    ) : (
      <MetricDelta
        value={kpis.reviews.trend}
        unit="percent"
        comparisonLabel={comparisonLabel}
      />
    )

  const replyRateValue = hasReviews
    ? `${formatNumber(replyPerformance.replyRate, { maximumFractionDigits: 1 })}%`
    : null
  const replyRateContext = hasReviews ? null : 'No reviews needed a reply in this period.'
  const replyTimeValue =
    replyPerformance.avgReplyHours === null
      ? null
      : formatReplyTime(replyPerformance.avgReplyHours)
  const replyTimeContext =
    replyTimeValue === null
      ? hasReviews
        ? 'No reviews have been replied to yet.'
        : 'No reviews needed a reply in this period.'
      : null

  return (
    <PageShell tier="dashboard">
      <PageHeader
        title="Ratings"
        description="How you are rated, and whether you are replying."
        breadcrumbs={trailCrumbs(
          'property',
          { propertyId: property.id, propertyName: property.name },
          NAV_LABEL.ratings,
        )}
        actions={<DashboardRangeControl range={range} onRangeChange={onRangeChange} />}
      />

      <MetricStrip aria-label="Ratings summary" variant="ruled">
        <Metric label="Average rating">
          <MetricValue
            value={
              kpis.avgRating.value === null ? null : (
                <RatingFigure value={kpis.avgRating.value} size="lg" />
              )
            }
            detail={ratingContext}
          />
        </Metric>
        <Metric label="Reviews">
          <MetricValue value={formatNumber(kpis.reviews.value)} detail={reviewContext} />
        </Metric>
        <Metric label={<GlossaryTerm term="reply-rate" />}>
          <MetricValue value={replyRateValue} detail={replyRateContext} />
        </Metric>
      </MetricStrip>

      <section aria-labelledby="ratings-trend-title" className="min-w-0 space-y-3">
        <h2 id="ratings-trend-title" className="text-lg font-semibold tracking-tight">
          Rating over time
        </h2>
        <PropertyReputationTrendChart
          ratingTrend={ratingTrend}
          reviewVolume={reviewVolume}
          range={range}
        />
      </section>

      <section aria-labelledby={distributionHeadingId} className="min-w-0 space-y-3">
        <h2 id={distributionHeadingId} className="text-lg font-semibold tracking-tight">
          Rating mix
        </h2>
        <RatingDistributionChart
          distribution={ratingDistribution}
          labelledBy={distributionHeadingId}
          label="Rating mix"
        />
      </section>

      <section aria-labelledby="ratings-responding-title" className="space-y-3">
        <h2
          id="ratings-responding-title"
          className="text-lg font-semibold tracking-tight"
        >
          Responding
        </h2>
        <MetricStrip aria-label="Responding" variant="ruled">
          <Metric label="Reply rate">
            <MetricValue value={replyRateValue} detail={replyRateContext} />
          </Metric>
          <Metric label="Average reply time">
            <MetricValue value={replyTimeValue} detail={replyTimeContext} />
          </Metric>
        </MetricStrip>
      </section>
    </PageShell>
  )
}
