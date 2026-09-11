// Dashboard → Ratings (redesign rows 1, 7a).
//
// PR 1 moves the three rating sections off the overview unchanged, under one
// heading and the shared range. PR 4 replaces the per-bucket rating line with a
// running average, turns the distribution into five horizontal bars, and gives
// the summary its own strip.
import { useId } from 'react'
import type { DashboardData } from '#/contexts/reporting/application/public-api'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { DashboardRangeControl } from '#/components/features/dashboard/dashboard-range-control'
import type { DashboardRange } from '#/shared/dashboard-range'
import { RatingDistributionChart } from '#/components/features/shared/rating-distribution-chart'
import { StatCard } from '#/components/features/shared/stat-card'
import { PropertyReputationTrendChart } from './property-reputation-trend-chart'

export interface PropertyRatingsPageProps {
  property: Readonly<{ id: string; name: string }> | null | undefined
  dashboard: DashboardData
  range: DashboardRange
  onRangeChange: (range: DashboardRange) => void
}

export function PropertyRatingsPage({
  property,
  dashboard,
  range,
  onRangeChange,
}: PropertyRatingsPageProps) {
  const distributionHeadingId = useId()
  if (!property) return null

  const { ratingDistribution, ratingTrend, reviewVolume, replyPerformance } = dashboard

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

      <section className="min-w-0 space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Rating over time</h2>
        <PropertyReputationTrendChart
          ratingTrend={ratingTrend}
          reviewVolume={reviewVolume}
        />
      </section>

      <section className="min-w-0 space-y-3">
        <h2 id={distributionHeadingId} className="text-lg font-semibold tracking-tight">
          Rating mix
        </h2>
        <RatingDistributionChart
          distribution={ratingDistribution}
          labelledBy={distributionHeadingId}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Responding</h2>
        <div className="grid grid-cols-2 gap-4">
          <StatCard label="Reply rate" value={`${replyPerformance.replyRate}%`} />
          <StatCard
            label="Average reply time"
            value={
              replyPerformance.avgReplyHours === null
                ? '—'
                : `${Math.round(replyPerformance.avgReplyHours)}h`
            }
          />
        </div>
      </section>
    </PageShell>
  )
}
