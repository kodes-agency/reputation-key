import { Link } from '@tanstack/react-router'
import { MessageSquare, Star, ScanLine, MessageCircle } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import type { DashboardData } from '#/contexts/dashboard/application/public-api'
import type { TimeRangePreset } from '#/contexts/dashboard/application/dto/dashboard.dto'
import { TIME_RANGE_OPTIONS } from '#/contexts/dashboard/application/dto/dashboard.dto'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { KPICard, RatingDistributionChart } from './property-dashboard-helpers'
import { ReviewRow } from './property-dashboard-review-row'

export interface PropertyDashboardProps {
  property: Readonly<{ id: string; name: string }> | null | undefined
  dashboard: DashboardData
  propertyId: string
  timeRange: TimeRangePreset
  onTimeRangeChange: (value: TimeRangePreset) => void
}

export function PropertyDashboard({
  property,
  dashboard,
  propertyId,
  timeRange,
  onTimeRangeChange,
}: PropertyDashboardProps) {
  if (!property) return null

  const { kpis, recentReviews, ratingDistribution, replyPerformance, engagementFunnel } =
    dashboard

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
        actions={
          <Tabs
            value={timeRange}
            onValueChange={(v) => onTimeRangeChange(v as TimeRangePreset)}
            className="min-w-0 shrink-0"
          >
            <TabsList className="flex-wrap">
              {TIME_RANGE_OPTIONS.map((opt) => (
                <TabsTrigger key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KPICard label="Reviews" kpi={kpis.reviews} icon={MessageSquare} />
        <KPICard
          label="Avg Rating"
          kpi={kpis.avgRating}
          icon={Star}
          formatValue={(v) => v.toFixed(1)}
        />
        <KPICard label="Scans" kpi={kpis.scans} icon={ScanLine} />
        <KPICard label="Feedback" kpi={kpis.feedback} icon={MessageCircle} />
      </div>

      {engagementFunnel && (
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Engagement Funnel
          </h2>
          <div className="mt-3 grid grid-cols-3 gap-4">
            {[
              { value: engagementFunnel.scans, label: 'Scans' },
              { value: engagementFunnel.ratings, label: 'Ratings' },
              { value: engagementFunnel.reviewLinkClicks, label: 'Review Clicks' },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border p-4 text-center">
                <p className="text-2xl font-semibold tabular-nums">{item.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <RatingDistributionChart distribution={ratingDistribution} />

      <div>
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Reply Performance
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-4">
          {[
            { value: `${replyPerformance.replyRate}%`, label: 'Reply Rate' },
            {
              value:
                replyPerformance.avgReplyHours === null
                  ? '—'
                  : `${Math.round(replyPerformance.avgReplyHours)}h`,
              label: 'Avg Reply Time',
            },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border p-4 text-center">
              <p className="text-2xl font-semibold tabular-nums">{item.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{item.label}</p>
            </div>
          ))}
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
