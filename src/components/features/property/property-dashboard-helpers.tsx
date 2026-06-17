import { Star, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import type {
  KPIValue,
  DashboardReplyStatus,
} from '#/contexts/dashboard/application/public-api'

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

export function Stars({ rating }: { rating: number }) {
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
}: {
  label: string
  kpi: KPIValue
  icon: React.ComponentType<{ className?: string }>
  formatValue?: (v: number) => string
}) {
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
          <TrendIndicator trend={kpi.trend} />
          {formatTrend(kpi.trend)}
        </span>
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
