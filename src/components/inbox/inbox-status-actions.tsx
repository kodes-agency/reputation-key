// Status + escalation actions — extracted for line-count compliance.
// Per ADR 0023: status (open ⇄ closed) and escalation (flag on/off) are
// orthogonal. Status transitions use updateInboxStatus; escalation actions
// use escalateInboxItem / resolveEscalation separately.
import type { InboxStatus } from '#/contexts/inbox/application/public-api'
import { AlertTriangle, ArchiveRestore, CheckCircle, RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'

type Variant = 'default' | 'outline' | 'secondary' | 'destructive'

export type StatusAction = Readonly<{
  label: string
  targetStatus: InboxStatus
  icon: ReactNode
  variant: Variant
}>

export type EscalationAction = Readonly<{
  label: string
  action: 'escalate' | 'resolve'
  icon: ReactNode
  variant: Variant
}>

/** Status transition buttons — open ⇄ closed (ADR 0023). No source-type guards. */
export function getStatusActions(status: InboxStatus): StatusAction[] {
  switch (status) {
    case 'open':
      return [
        {
          label: 'Close',
          targetStatus: 'closed',
          icon: <CheckCircle className="size-3.5" />,
          variant: 'default',
        },
      ]
    case 'closed':
      return [
        {
          label: 'Reopen',
          targetStatus: 'open',
          icon: <RotateCcw className="size-3.5" />,
          variant: 'outline',
        },
      ]
  }
}

/** Escalation-flag actions — orthogonal to status.
 *  Active flag (escalated AND not yet resolved) → can resolve; otherwise escalate. */
export function getEscalationActions(
  isEscalated: boolean,
  escalationResolvedAt: Date | null,
): EscalationAction[] {
  const isActive = isEscalated && escalationResolvedAt === null
  if (isActive) {
    return [
      {
        label: 'Resolve escalation',
        action: 'resolve',
        icon: <ArchiveRestore className="size-3.5" />,
        variant: 'outline',
      },
    ]
  }
  return [
    {
      label: 'Escalate',
      action: 'escalate',
      icon: <AlertTriangle className="size-3.5" />,
      variant: 'destructive',
    },
  ]
}
