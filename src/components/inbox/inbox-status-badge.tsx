import { Badge } from '#/components/ui/badge'
import { AlertTriangle } from 'lucide-react'
import type { InboxStatus } from '#/contexts/inbox/application/public-api'

type Props = Readonly<{
  status: InboxStatus
  isEscalated?: boolean
  escalationResolvedAt?: Date | null
}>

const statusConfig: Record<
  InboxStatus,
  { label: string; variant: 'default' | 'secondary' | 'outline'; className?: string }
> = {
  open: { label: 'Open', variant: 'default' },
  closed: {
    label: 'Closed',
    variant: 'secondary',
    className: 'opacity-60',
  },
}

export function InboxStatusBadge({
  status,
  isEscalated = false,
  escalationResolvedAt = null,
}: Props) {
  const config = statusConfig[status]
  const isEscalationActive = isEscalated && escalationResolvedAt === null
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant={config.variant} className={config.className}>
        {config.label}
      </Badge>
      {isEscalationActive && (
        <Badge
          variant="destructive"
          title="Escalated — needs management attention"
          aria-label="Escalated"
        >
          <AlertTriangle className="size-3" />
          <span className="sr-only">Escalated</span>
        </Badge>
      )}
    </span>
  )
}
