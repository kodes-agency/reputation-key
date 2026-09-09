import { useId } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import type {
  AttentionSignals,
  DashboardData,
} from '#/contexts/reporting/application/public-api'
import type { TimeRangePreset } from '#/contexts/reporting/application/dto/dashboard.dto'
import type { PropertyPerformancePreset } from '#/shared/google-performance-report-contract'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { formatTrend, TrendIndicator } from './property-dashboard-helpers'
import { RatingDistributionChart } from '#/components/features/shared/rating-distribution-chart'
import { StatCard } from '#/components/features/shared/stat-card'
import { PropertyReputationTrendChart } from './property-reputation-trend-chart'
import { ReviewRow } from './property-dashboard-review-row'
import { AttentionBand } from './attention-band'
import { GooglePerformanceSection } from './google-performance-section'
import type { GooglePerformanceServerFns } from './use-google-performance'
import { TimeRangePicker } from '#/components/features/dashboard/time-range-picker'
import { ratingPresentation } from '#/components/features/dashboard/rating-presentation'
import {
  PropertyAiTrendSection,
  type PropertyAiTrendServerFn,
} from './property-ai-trend-section'
import {
  PropertyAiAggregateSection,
  type PropertyAiAggregatesServerFn,
} from './property-ai-aggregate-section'

export interface PropertyDashboardProps {
  property: Readonly<{ id: string; name: string }> | null | undefined
  dashboard: DashboardData
  signals: AttentionSignals
  propertyId: string
  timeRange: TimeRangePreset
  onTimeRangeChange: (value: TimeRangePreset) => void
  performanceRange: PropertyPerformancePreset
  onPerformanceRangeChange: (value: PropertyPerformancePreset) => void
  performanceFns: GooglePerformanceServerFns
  getAiTrend: PropertyAiTrendServerFn
  getAiAggregates: PropertyAiAggregatesServerFn
}

export function PropertyDashboard({
  property,
  dashboard,
  signals,
  propertyId,
  timeRange,
  onTimeRangeChange,
  performanceRange,
  onPerformanceRangeChange,
  performanceFns,
  getAiTrend,
  getAiAggregates,
}: PropertyDashboardProps) {
  const ratingDistributionHeadingId = useId()
  if (!property) return null

  const {
    kpis,
    recentReviews,
    ratingDistribution,
    ratingTrend,
    reviewVolume,
    replyPerformance,
    engagementFunnel,
  } = dashboard
  const rating = ratingPresentation(kpis.avgRating, timeRange)

  return (
    <PageShell tier="dashboard">
      <PageHeader
        title="Overview"
        description={property.name}
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: property.name },
          { label: 'Overview' },
        ]}
        actions={<TimeRangePicker timeRange={timeRange} onChange={onTimeRangeChange} />}
      />

      <AttentionBand signals={signals} propertyId={propertyId} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Reviews"
          value={String(kpis.reviews.value)}
          hint={
            <span className="flex items-center gap-0.5">
              <TrendIndicator trend={kpis.reviews.trend} />
              {formatTrend(kpis.reviews.trend)}
            </span>
          }
          availability={{
            subject: 'reviews',
            state: 'ready',
            dataThrough: null,
            reason: null,
          }}
        />
        <StatCard
          label="Avg Rating"
          value={rating.value}
          hint={
            <>
              <span className="flex items-center gap-0.5">
                <TrendIndicator trend={kpis.avgRating.comparison} />
                {kpis.avgRating.comparison === null
                  ? rating.comparison
                  : `${rating.comparison} stars`}
              </span>
              {kpis.avgRating.evidence.state === 'ready' ? (
                <span className="block">{rating.evidence}</span>
              ) : null}
            </>
          }
          availability={{
            subject: 'ratings',
            state: kpis.avgRating.evidence.state,
            dataThrough: kpis.avgRating.evidence.verifiedThrough,
            reason: kpis.avgRating.evidence.availabilityReason,
          }}
        />
        <StatCard
          label="Scans"
          value={kpis.scans.value === null ? '—' : String(kpis.scans.value)}
          hint={
            kpis.scans.evidence.current.state === 'ready' && kpis.scans.value !== null ? (
              <span className="flex items-center gap-0.5">
                <TrendIndicator trend={kpis.scans.trend} />
                {formatTrend(kpis.scans.trend)}
              </span>
            ) : undefined
          }
          availability={{
            subject: 'scans',
            state: kpis.scans.evidence.current.state,
            dataThrough: null,
            reason: null,
          }}
        />
        <StatCard
          label="Feedback"
          value={kpis.feedback.value === null ? '—' : String(kpis.feedback.value)}
          hint={
            kpis.feedback.evidence.current.state === 'ready' &&
            kpis.feedback.value !== null ? (
              <span className="flex items-center gap-0.5">
                <TrendIndicator trend={kpis.feedback.trend} />
                {formatTrend(kpis.feedback.trend)}
              </span>
            ) : undefined
          }
          availability={{
            subject: 'private_feedback',
            state: kpis.feedback.evidence.current.state,
            dataThrough: null,
            reason: null,
          }}
        />
      </div>

      <GooglePerformanceSection
        key={`${propertyId}:${performanceRange}`}
        propertyId={propertyId}
        preset={performanceRange}
        onPresetChange={onPerformanceRangeChange}
        serverFns={performanceFns}
      />
      <PropertyAiTrendSection propertyId={propertyId} getTrend={getAiTrend} />
      <PropertyAiAggregateSection
        propertyId={propertyId}
        getAggregates={getAiAggregates}
      />

      {engagementFunnel && (
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Engagement Funnel
          </h2>
          <div className="mt-3 grid grid-cols-3 gap-4">
            {[
              { value: String(engagementFunnel.scans), label: 'Scans' },
              { value: String(engagementFunnel.ratings), label: 'Ratings' },
              {
                value: String(engagementFunnel.reviewLinkClicks),
                label: 'Review Clicks',
              },
            ].map((item) => (
              <StatCard key={item.label} label={item.label} value={item.value} />
            ))}
          </div>
        </div>
      )}

      <div className="min-w-0">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Reputation over time
        </h2>
        <div className="mt-3">
          <PropertyReputationTrendChart
            ratingTrend={ratingTrend}
            reviewVolume={reviewVolume}
          />
        </div>
      </div>

      <div className="min-w-0">
        <h2
          id={ratingDistributionHeadingId}
          className="text-sm font-medium uppercase tracking-wide text-muted-foreground"
        >
          Rating Distribution
        </h2>
        <div className="mt-3">
          <RatingDistributionChart
            distribution={ratingDistribution}
            labelledBy={ratingDistributionHeadingId}
          />
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Reply Performance
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <StatCard label="Reply Rate" value={`${replyPerformance.replyRate}%`} />
          <StatCard
            label="Avg Reply Time"
            value={
              replyPerformance.avgReplyHours === null
                ? '—'
                : `${Math.round(replyPerformance.avgReplyHours)}h`
            }
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Recent Reviews
          </h2>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/inbox" search={{ propertyId }}>
              View all
            </Link>
          </Button>
        </div>
        {recentReviews.length === 0 ? (
          <div className="mt-3 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No reviews yet.
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {recentReviews.map((review) => (
              <ReviewRow key={review.id} review={review} />
            ))}
          </div>
        )}
      </div>
    </PageShell>
  )
}
