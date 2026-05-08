import { AlertCircle, CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import type { GbpImportJobStatus } from '#/shared/domain'

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
    completed_with_skips: {
      icon: AlertCircle,
      label: 'Completed (some skipped)',
      variant: 'outline' as const,
    },
    failed: {
      icon: XCircle,
      label: 'Failed',
      variant: 'destructive' as const,
    },
  }

  const { icon: Icon, label, variant } = variants[status]

  return (
    <Badge variant={variant} className="gap-1.5" role="status" aria-live="polite">
      <Icon
        className={`size-3.5${status === 'in_progress' ? ' animate-spin' : ''}`}
        aria-hidden="true"
      />
      {label}
    </Badge>
  )
}
