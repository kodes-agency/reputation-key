import { createFileRoute, getRouteApi, Link } from '@tanstack/react-router'
import {
  MessageSquare,
  Star,
  ScanLine,
  MessageCircle,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { getDashboardDataFn } from '#/contexts/dashboard/server/dashboard'
import type { KPIValue, RecentReview, DashboardReplyStatus } from '#/contexts/dashboard/domain/types'

const propertyRoute = getRouteApi('/_authenticated/properties/$propertyId')

export const Route = createFileRoute('/_authenticated/properties/$propertyId/')({
  staleTime: 60_000,
  loader: async ({ params: { propertyId } }) => {
    const dashboard = await getDashboardDataFn({ data: { propertyId, timeRange: '30d' } })
    return { dashboard }
  },
  component: PropertyDashboard,
})

// ── Helpers ──────────────────────────────────────────────────────

function formatTrend(trend: number | null): string {
  if (trend === null) return '—'
  const abs = Math.abs(trend)
  return `${abs}%`
}

function TrendIndicator({ trend }: { trend: number | null }) {
  if (trend === null) return <Minus className="size-3 text-muted-foreground" />
  if (trend > 0) return <ArrowUpRight className="size-3 text-emerald-500" />
  if (trend < 0) return <ArrowDownRight className="size-3 text-red-500" />
  return <Minus className="size-3 text-muted-foreground" />
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={`size-3 ${i < Math.round(rating) ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}`}
        />
      ))}
    </span>
  )
}

function ReplyStatusBadge({ status }: { status: DashboardReplyStatus }) {
  const variant = status === 'published' ? 'default' : status === 'draft' ? 'secondary' : 'outline'
  const label = status === 'none' ? 'No reply' : status === 'draft' ? 'Draft' : 'Published'
  return <Badge variant={variant}>{label}</Badge>
}

// ── KPI Card ─────────────────────────────────────────────────────

function KPICard({
  label,
  kpi,
  icon: Icon,
  formatValue,
}: {
  label: string
  kpi: KPIValue
  icon: React.ComponentType<{ className?: string }>
  formatValue?: (v: number) => string
}) {
  const trendPct = kpi.trend
  const display = formatValue ? formatValue(kpi.value) : String(kpi.value)

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <p className="text-2xl font-semibold tabular-nums">{display}</p>
        <span className="flex items-center gap-0.5 text-xs tabular-nums text-muted-foreground">
          <TrendIndicator trend={trendPct} />
          {formatTrend(trendPct)}
        </span>
      </div>
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────

function PropertyDashboard() {
  const { property } = propertyRoute.useLoaderData()
  const { dashboard } = Route.useLoaderData()
  const { propertyId } = propertyRoute.useParams()

  if (!property) return null

  const { kpis, recentReviews, ratingDistribution, replyPerformance, engagementFunnel } = dashboard

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">{property.name}</p>
      </div>

      {/* KPI strip */}
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

      {/* Engagement funnel */}
      {engagementFunnel && (
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Engagement Funnel
          </h2>
          <div className="mt-3 grid grid-cols-3 gap-4">
            <div className="rounded-lg border p-4 text-center">
              <p className="text-2xl font-semibold tabular-nums">{engagementFunnel.scans}</p>
              <p className="mt-1 text-xs text-muted-foreground">Scans</p>
            </div>
            <div className="rounded-lg border p-4 text-center">
              <p className="text-2xl font-semibold tabular-nums">{engagementFunnel.ratings}</p>
              <p className="mt-1 text-xs text-muted-foreground">Ratings</p>
            </div>
            <div className="rounded-lg border p-4 text-center">
              <p className="text-2xl font-semibold tabular-nums">{engagementFunnel.reviewLinkClicks}</p>
              <p className="mt-1 text-xs text-muted-foreground">Review Clicks</p>
            </div>
          </div>
        </div>
      )}

      {/* Rating distribution */}
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

      {/* Reply performance */}
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Reply Performance
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <div className="rounded-lg border p-4 text-center">
            <p className="text-2xl font-semibold tabular-nums">{replyPerformance.replyRate}%</p>
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

      {/* Recent reviews */}
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Recent Reviews
          </h2>
          <Button variant="ghost" size="sm" asChild>
            <Link
              to="/inbox"
              search={{ propertyId }}
            >
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

function ReviewRow({ review }: { review: RecentReview }) {
  return (
    <div className="flex items-center gap-4 rounded-lg border p-3">
      <div className="flex flex-col items-center gap-1">
        <span className="text-lg font-semibold">{review.rating}</span>
        <Stars rating={review.rating} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{review.snippet}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {review.reviewedAt.toLocaleDateString()}
        </p>
      </div>
      <ReplyStatusBadge status={review.replyStatus} />
    </div>
  )
}
