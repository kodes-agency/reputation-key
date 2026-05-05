import { Badge } from '#/components/ui/badge'
import { CheckCircle2, Circle, XCircle, Loader2 } from 'lucide-react'
import type { GbpImportJobStatus } from '#/contexts/integration/domain/types'

interface ImportStatusBadgeProps {
  status: GbpImportJobStatus
}

export function ImportStatusBadge({ status }: ImportStatusBadgeProps) {
  const variants = {
    queued: { icon: Circle, label: 'Queued', variant: 'secondary' as const },
    in_progress: {
      icon: Loader2,
      label: 'Importing...',
      variant: 'default' as const,
    },
    completed: {
      icon: CheckCircle2,
      label: 'Complete',
      variant: 'default' as const,
    },
    failed: {
      icon: XCircle,
      label: 'Failed',
      variant: 'destructive' as const,
    },
  }

  const { icon: Icon, label, variant } = variants[status]

  return (
    <Badge variant={variant} className="gap-1.5">
      {status === 'in_progress' && (
        <Icon className="size-3.5 animate-spin" />
      )}
      {status !== 'in_progress' && <Icon className="size-3.5" />}
      {label}
    </Badge>
  )
}
