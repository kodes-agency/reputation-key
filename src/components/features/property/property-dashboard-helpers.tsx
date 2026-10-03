import { Star } from 'lucide-react'
import { StatusBadge, type StatusMap } from '#/components/ui/status-badge'
import type { DashboardReplyStatus } from '#/contexts/reporting/application/public-api'

export function Stars({ rating }: { rating: number | null }) {
  return (
    <span className="inline-flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={`size-3 ${rating !== null && i < Math.round(rating) ? 'fill-current text-rating' : 'text-muted-foreground/30'}`}
        />
      ))}
    </span>
  )
}

const REPLY_STATUS: StatusMap<DashboardReplyStatus> = {
  published: { label: 'Published', tone: 'positive' },
  draft: { label: 'Draft', tone: 'neutral' },
  none: { label: 'No reply', tone: 'neutral' },
}

export function ReplyStatusBadge({ status }: { status: DashboardReplyStatus }) {
  return <StatusBadge status={status} map={REPLY_STATUS} />
}
