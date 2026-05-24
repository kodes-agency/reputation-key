// Property dashboard — extracted from route for testability and separation of concerns
import { Link } from '@tanstack/react-router'
import { MessageSquare, Star, ScanLine, MessageCircle } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import type { DashboardData } from '#/contexts/dashboard/application/public-api'
import type { TimeRangePreset } from '#/contexts/dashboard/application/dto/dashboard.dto'
import { TIME_RANGE_OPTIONS } from '#/contexts/dashboard/application/dto/dashboard.dto'
import { KPICard } from './property-dashboard-helpers'
import { ReviewRow } from './property-dashboard-review-row'

interface Property {
  id: string
  name: string
}

export interface PropertyDashboardProps {
  property: Property | null | undefined
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
    <div className="min-w-0 space-y-8">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">{property.name}</p>
        </div>
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
      </div>

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
            <div className="rounded-lg border p-4 text-center">
              <p className="text-2xl font-semibold tabular-nums">
                {engagementFunnel.scans}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Scans</p>
            </div>
            <div className="rounded-lg border p-4 text-center">
              <p className="text-2xl font-semibold tabular-nums">
                {engagementFunnel.ratings}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Ratings</p>
            </div>
            <div className="rounded-lg border p-4 text-center">
              <p className="text-2xl font-semibold tabular-nums">
                {engagementFunnel.reviewLinkClicks}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Review Clicks</p>
            </div>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Rating Distribution
        </h2>
        <div className="mt-3 space-y-2">
          {ratingDistribution.map((bucket) => (
            <div key={bucket.stars} className="flex items-center gap-3">
              <span className="w-8 text-right text-sm tabular-nums">{bucket.stars}★</span>
              <div className="flex-1">
                <div
                  className="h-2 rounded-full bg-primary transition-all"
                  style={{
                    width: `${Math.min(100, (bucket.count / Math.max(...ratingDistribution.map((b) => b.count), 1)) * 100)}%`,
                  }}
                />
              </div>
              <span className="w-8 text-sm tabular-nums text-muted-foreground">
                {bucket.count}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Reply Performance
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <div className="rounded-lg border p-4 text-center">
            <p className="text-2xl font-semibold tabular-nums">
              {replyPerformance.replyRate}%
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Reply Rate</p>
          </div>
          <div className="rounded-lg border p-4 text-center">
            <p className="text-2xl font-semibold tabular-nums">
              {replyPerformance.avgReplyHours === null
                ? '—'
                : `${Math.round(replyPerformance.avgReplyHours)}h`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Avg Reply Time</p>
          </div>
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
    </div>
  )
}
