import type { ComponentType } from 'react'
import { Star, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import type {
  DashboardReplyStatus,
  KPIValue,
  MetricAvailabilityState,
  MetricKPIValue,
  RatingKPIValue,
} from '#/contexts/dashboard/application/public-api'
import type { TimeRangePreset } from '#/contexts/dashboard/application/dto/dashboard.dto'
import { AvailabilityLine } from '#/components/features/dashboard/availability-line'
import { ratingPresentation } from '#/components/features/dashboard/rating-presentation'

export function formatTrend(trend: number | null): string {
  if (trend === null) return '—'
  return `${Math.abs(trend)}%`
}

export function TrendIndicator({ trend }: { trend: number | null }) {
  if (trend === null) return <Minus className="size-3 text-muted-foreground" />
  if (trend > 0) return <ArrowUpRight className="size-3 text-emerald-500" />
  if (trend < 0) return <ArrowDownRight className="size-3 text-red-500" />
  return <Minus className="size-3 text-muted-foreground" />
}

export function Stars({ rating }: { rating: number | null }) {
  return (
    <span className="inline-flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={`size-3 ${rating !== null && i < Math.round(rating) ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}`}
        />
      ))}
    </span>
  )
}

export function ReplyStatusBadge({ status }: { status: DashboardReplyStatus }) {
  const variant =
    status === 'published' ? 'default' : status === 'draft' ? 'secondary' : 'outline'
  const label =
    status === 'none' ? 'No reply' : status === 'draft' ? 'Draft' : 'Published'
  return <Badge variant={variant}>{label}</Badge>
}

export function KPICard({
  label,
  kpi,
  icon: Icon,
  formatValue,
}: Readonly<{
  label: string
  kpi: KPIValue | MetricKPIValue
  icon: ComponentType<{ className?: string }>
  formatValue?: (value: number) => string
}>) {
  const state: MetricAvailabilityState =
    'evidence' in kpi ? kpi.evidence.current.state : 'ready'
  const value =
    kpi.value === null ? '—' : formatValue ? formatValue(kpi.value) : String(kpi.value)
  const showTrend = state === 'ready' && kpi.value !== null

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {showTrend ? (
          <span className="flex items-center gap-0.5 text-xs tabular-nums text-muted-foreground">
            <TrendIndicator trend={kpi.trend} />
            {formatTrend(kpi.trend)}
          </span>
        ) : null}
      </div>
      <div className="mt-1">
        <AvailabilityLine state={state} dataThrough={null} reason={null} />
      </div>
    </div>
  )
}

export function RatingKPICard({
  label,
  kpi,
  icon: Icon,
  timeRange,
}: Readonly<{
  label: string
  kpi: RatingKPIValue
  icon: ComponentType<{ className?: string }>
  timeRange: TimeRangePreset
}>) {
  const presentation = ratingPresentation(kpi, timeRange)
  const ComparisonIcon =
    presentation.direction === 'up'
      ? ArrowUpRight
      : presentation.direction === 'down'
        ? ArrowDownRight
        : Minus
  // 12px text needs 4.5:1: emerald/red-500 measure 2.3:1 on the light surface,
  // so each direction pairs a light-mode and a dark-mode ramp step.
  const comparisonClass =
    presentation.direction === 'up'
      ? 'text-emerald-700 dark:text-emerald-400'
      : presentation.direction === 'down'
        ? 'text-red-700 dark:text-red-400'
        : 'text-muted-foreground'

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <p className="text-2xl font-semibold tabular-nums">{presentation.value}</p>
        <span
          className={`flex items-center gap-0.5 text-xs tabular-nums ${comparisonClass}`}
        >
          <ComparisonIcon className="size-3" />
          {kpi.comparison === null
            ? presentation.comparison
            : `${presentation.comparison} stars`}
        </span>
      </div>
      {kpi.evidence.state === 'ready' ? (
        <p className="mt-1 text-xs text-muted-foreground">{presentation.evidence}</p>
      ) : null}
      <div className="mt-1">
        <AvailabilityLine
          state={kpi.evidence.state}
          dataThrough={kpi.evidence.verifiedThrough}
          reason={kpi.evidence.availabilityReason}
        />
      </div>
    </div>
  )
}

export function RatingDistributionChart({
  distribution,
}: {
  distribution: ReadonlyArray<{ stars: number; count: number }>
}) {
  const max = Math.max(...distribution.map((b) => b.count), 1)
  return (
    <div>
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Rating Distribution
      </h2>
      <div className="mt-3 space-y-2">
        {distribution.map((bucket) => (
          <div key={bucket.stars} className="flex items-center gap-3">
            <span className="w-8 text-right text-sm tabular-nums">{bucket.stars}★</span>
            <div className="flex-1">
              <div
                className="h-2 rounded-full bg-primary transition-all"
                style={{ width: `${Math.min(100, (bucket.count / max) * 100)}%` }}
              />
            </div>
            <span className="w-8 text-sm tabular-nums text-muted-foreground">
              {bucket.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
