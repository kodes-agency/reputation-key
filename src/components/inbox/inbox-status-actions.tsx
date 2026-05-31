// Status transition actions — extracted from inbox-detail-helpers for line-count compliance
import type { InboxStatus, SourceType } from '#/contexts/inbox/application/public-api'
import { AlertTriangle, Archive, CheckCircle } from 'lucide-react'
import type { ReactNode } from 'react'

// Status transition buttons — which actions are available per status + sourceType
export function getStatusActions(
  status: InboxStatus,
  sourceType: SourceType,
): Array<{
  label: string
  targetStatus: InboxStatus
  icon: ReactNode
  variant: 'default' | 'outline' | 'secondary' | 'destructive'
}> {
  switch (status) {
    case 'new':
      if (sourceType === 'review') {
        return [
          {
            label: 'Escalate',
            targetStatus: 'escalated',
            icon: <AlertTriangle className="size-3.5" />,
            variant: 'destructive',
          },
          {
            label: 'Archive',
            targetStatus: 'archived',
            icon: <Archive className="size-3.5" />,
            variant: 'secondary',
          },
        ]
      }
      // feedback — also gets "Mark Addressed" (new → addressed transition)
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
        {
          label: 'Archive',
          targetStatus: 'archived',
          icon: <Archive className="size-3.5" />,
          variant: 'secondary',
        },
      ]
    case 'read':
      if (sourceType === 'review') {
        return [
          {
            label: 'Escalate',
            targetStatus: 'escalated',
            icon: <AlertTriangle className="size-3.5" />,
            variant: 'destructive',
          },
          {
            label: 'Archive',
            targetStatus: 'archived',
            icon: <Archive className="size-3.5" />,
            variant: 'secondary',
          },
        ]
      }
      // feedback
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
        {
          label: 'Archive',
          targetStatus: 'archived',
          icon: <Archive className="size-3.5" />,
          variant: 'secondary',
        },
      ]
    case 'escalated':
      if (sourceType === 'review') {
        return [
          {
            label: 'Archive',
            targetStatus: 'archived',
            icon: <Archive className="size-3.5" />,
            variant: 'secondary',
          },
        ]
      }
      // feedback
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
    case 'addressed':
      return [
        {
          label: 'Escalate',
          targetStatus: 'escalated',
          icon: <AlertTriangle className="size-3.5" />,
          variant: 'destructive',
        },
        {
          label: 'Archive',
          targetStatus: 'archived',
          icon: <Archive className="size-3.5" />,
          variant: 'secondary',
        },
      ]
    case 'archived':
      return [
        {
          label: 'Escalate',
          targetStatus: 'escalated',
          icon: <AlertTriangle className="size-3.5" />,
          variant: 'destructive',
        },
      ]
  }
}
