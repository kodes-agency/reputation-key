// Inbox detail helpers — extracted from inbox-detail-sheet for line-count compliance
import type { InboxStatus } from '#/contexts/inbox/application/public-api'
import { Star, AlertTriangle, Archive, CheckCircle, Eye } from 'lucide-react'
import type { ReactNode } from 'react'

// Status transition buttons — which actions are available per status
export function getStatusActions(status: InboxStatus): Array<{
  label: string
  targetStatus: InboxStatus
  icon: ReactNode
  variant: 'default' | 'outline' | 'secondary' | 'destructive'
}> {
  switch (status) {
    case 'new':
      return [
        {
          label: 'Mark Read',
          targetStatus: 'read',
          icon: <Eye className="size-3.5" />,
          variant: 'outline',
        },
        {
          label: 'Escalate',
          targetStatus: 'escalated',
          icon: <AlertTriangle className="size-3.5" />,
          variant: 'destructive',
        },
      ]
    case 'read':
      return [
        {
          label: 'Mark Addressed',
          targetStatus: 'addressed',
          icon: <CheckCircle className="size-3.5" />,
          variant: 'default',
        },
        {
          label: 'Escalate',
          targetStatus: 'escalated',
          icon: <AlertTriangle className="size-3.5" />,
          variant: 'destructive',
        },
      ]
    case 'addressed':
      return [
        {
          label: 'Archive',
          targetStatus: 'archived',
          icon: <Archive className="size-3.5" />,
          variant: 'secondary',
        },
      ]
    case 'escalated':
      return [
        {
          label: 'Mark Addressed',
          targetStatus: 'addressed',
          icon: <CheckCircle className="size-3.5" />,
          variant: 'default',
        },
        {
          label: 'Archive',
          targetStatus: 'archived',
          icon: <Archive className="size-3.5" />,
          variant: 'secondary',
        },
      ]
    case 'archived':
      return [] // No forward transitions from archived — domain rules enforce forward-only
  }
}

export function RatingStars({ rating }: Readonly<{ rating: number | null }>) {
  if (rating === null) return null
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`size-4 ${
            i < rating ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/30'
          }`}
        />
      ))}
      <span className="ml-1 text-sm font-medium">{rating}/5</span>
    </div>
  )
}
