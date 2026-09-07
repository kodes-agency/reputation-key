import { Star, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import type { DashboardReplyStatus } from '#/contexts/reporting/application/public-api'

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
