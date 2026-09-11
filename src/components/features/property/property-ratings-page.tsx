// Dashboard → Ratings (redesign rows 7a, 8, 9, 10, 12–14).
import { useId, type ReactNode } from 'react'
import type { DashboardData } from '#/contexts/reporting/application/public-api'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { DashboardRangeControl } from '#/components/features/dashboard/dashboard-range-control'
import { GlossaryTerm } from '#/components/features/shared/glossary-term'
import { RatingDistributionChart } from '#/components/features/shared/rating-distribution-chart'
import {
  dashboardRangeComparisonLabel,
  DASHBOARD_RANGE_LABELS,
  type DashboardRange,
} from '#/shared/dashboard-range'
import { cn } from '#/lib/utils'
import { PropertyReputationTrendChart } from './property-reputation-trend-chart'

export interface PropertyRatingsPageProps {
  property: Readonly<{ id: string; name: string }> | null | undefined
  dashboard: DashboardData
  range: DashboardRange
  onRangeChange: (range: DashboardRange) => void
}

function MetricFigure({
  label,
  value,
  context,
  className,
}: Readonly<{
  label: ReactNode
  value: string | null
  context?: ReactNode
  className?: string
}>) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      {value === null ? null : (
        <dd className="mt-1 text-3xl font-semibold tabular-nums">{value}</dd>
      )}
      {context ? (
        <dd
          className={cn(
            'text-sm text-muted-foreground',
            value === null ? 'mt-1' : 'mt-0.5',
          )}
        >
          {context}
        </dd>
      ) : null}
    </div>
  )
}

function Delta({
  value,
  comparisonLabel,
  unit,
}: Readonly<{
  value: number
  comparisonLabel: string
  unit: 'rating' | 'percent'
}>) {
  if (value === 0) return <>No change {comparisonLabel}</>
  const increased = value > 0
  const magnitude =
    unit === 'rating'
      ? Math.abs(value).toFixed(1)
      : Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 1 })

  return (
    <span className={increased ? 'text-positive' : 'text-destructive'}>
      {increased ? '↑' : '↓'} {magnitude}
      {unit === 'percent' ? '%' : ''} {comparisonLabel}
    </span>
  )
}

function formatReplyTime(hours: number): string {
  if (hours < 1) return 'Less than 1 hour'
  if (hours < 24) {
    const rounded = Math.round(hours * 10) / 10
    return `${rounded.toLocaleString()} ${rounded === 1 ? 'hour' : 'hours'}`
  }
  const days = Math.round((hours / 24) * 10) / 10
  return `${days.toLocaleString()} ${days === 1 ? 'day' : 'days'}`
}

export function PropertyRatingsPage({
  property,
  dashboard,
  range,
  onRangeChange,
}: PropertyRatingsPageProps) {
  const distributionHeadingId = useId()
  if (!property) return null

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
      <Delta
        value={kpis.avgRating.comparison}
        comparisonLabel={comparisonLabel}
        unit="rating"
      />
    )

  const reviewContext =
    comparisonLabel === null ? null : kpis.reviews.trend === null ? (
      `No reviews in the previous ${DASHBOARD_RANGE_LABELS[range].toLowerCase()} to compare.`
    ) : (
      <Delta
        value={kpis.reviews.trend}
        comparisonLabel={comparisonLabel}
        unit="percent"
      />
    )

  const replyRateValue = hasReviews
    ? `${replyPerformance.replyRate.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
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
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: property.name },
          { label: 'Ratings' },
        ]}
        actions={<DashboardRangeControl range={range} onRangeChange={onRangeChange} />}
      />

      <dl
        aria-label="Ratings summary"
        className="grid divide-y border-y sm:grid-cols-3 sm:divide-x sm:divide-y-0"
      >
        <MetricFigure
          label="Average rating"
          value={
            kpis.avgRating.value === null ? null : `${kpis.avgRating.value.toFixed(1)} ★`
          }
          context={ratingContext}
          className="py-4 sm:pr-4"
        />
        <MetricFigure
          label="Reviews"
          value={kpis.reviews.value.toLocaleString()}
          context={reviewContext}
          className="py-4 sm:px-4"
        />
        <MetricFigure
          label={<GlossaryTerm term="reply-rate" />}
          value={replyRateValue}
          context={replyRateContext}
          className="py-4 sm:pl-4"
        />
      </dl>

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
        <dl className="grid gap-4 sm:grid-cols-2">
          <MetricFigure
            label="Reply rate"
            value={replyRateValue}
            context={replyRateContext}
            className="border-t pt-3"
          />
          <MetricFigure
            label="Average reply time"
            value={replyTimeValue}
            context={replyTimeContext}
            className="border-t pt-3"
          />
        </dl>
      </section>
    </PageShell>
  )
}
