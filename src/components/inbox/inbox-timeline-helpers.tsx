// Inbox activity timeline helpers — icon mapping, label formatting, date/time utils.
// Extracted from inbox-activity-timeline.tsx for max-lines compliance.

import type { ActivityLog } from '#/contexts/activity/application/public-api'
import {
  MessageSquarePlus,
  UserPlus,
  UserMinus,
  AlertTriangle,
  Send,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Layers,
  Pencil,
  Plus,
  Clock,
} from 'lucide-react'

export function actionIcon(action: string) {
  switch (action) {
    case 'created':
      return <Plus className="size-3.5" />
    case 'changed':
      return <ArrowRight className="size-3.5" />
    case 'assigned':
      return <UserPlus className="size-3.5" />
    case 'unassigned':
      return <UserMinus className="size-3.5" />
    case 'escalated':
      return <AlertTriangle className="size-3.5" />
    case 'added':
      return <MessageSquarePlus className="size-3.5" />
    case 'published':
      return <Send className="size-3.5" />
    case 'submitted':
      return <Pencil className="size-3.5" />
    case 'approved':
      return <CheckCircle2 className="size-3.5" />
    case 'rejected':
      return <XCircle className="size-3.5" />
    default:
      return <Layers className="size-3.5" />
  }
}

export function actionLabel(entry: ActivityLog): string {
  const { action, payload } = entry
  switch (action) {
    case 'created':
      return `Created from ${payload.detail ?? 'source'}`
    case 'changed':
      return `Status changed from ${payload.from ?? 'unknown'} to ${payload.to ?? 'unknown'}`
    case 'assigned':
      return 'Assigned to user'
    case 'unassigned':
      return 'Unassigned'
    case 'escalated':
      return `Escalated from ${payload.from ?? 'unknown'}`
    case 'added':
      return 'Added note'
    case 'published':
      return 'Published reply'
    case 'submitted':
      return 'Submitted reply for approval'
    case 'approved':
      return 'Approved reply'
    case 'rejected':
      return payload.detail ? `Rejected reply: ${payload.detail}` : 'Rejected reply'
    default:
      return action
  }
}

export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function formatActorAndTime(actorName: string, createdAt: Date | string) {
  return (
    <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
      <span>{actorName}</span>
      <span>·</span>
      <span className="flex items-center gap-1">
        <Clock className="size-3" />
        {formatTime(createdAt)}
      </span>
    </div>
  )
}
