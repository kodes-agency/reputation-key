import { Badge } from '#/components/ui/badge'
import type { InboxStatus } from '#/contexts/inbox/application/public-api'

type Props = Readonly<{
  status: InboxStatus
}>

const statusConfig: Record<
  InboxStatus,
  {
    label: string
    variant: 'default' | 'secondary' | 'outline' | 'destructive'
    className?: string
  }
> = {
  new: { label: 'New', variant: 'default' },
  read: { label: 'Opened', variant: 'secondary' },
  addressed: {
    label: 'Addressed',
    variant: 'outline',
    className: 'border-green-500 text-green-700 dark:text-green-400',
  },
  escalated: { label: 'Escalated', variant: 'destructive' },
  archived: { label: 'Archived', variant: 'secondary', className: 'opacity-60' },
}

export function InboxStatusBadge({ status }: Props) {
  const config = statusConfig[status]
  return (
    <Badge variant={config.variant} className={config.className}>
      {config.label}
    </Badge>
  )
}
