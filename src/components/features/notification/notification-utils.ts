// Notification UI utilities — route resolver, relative time, icon mapping.

import {
  Bell,
  MessageSquare,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Target,
  UserPlus,
  FileEdit,
  Send,
  type LucideIcon,
} from 'lucide-react'
import type {
  NotificationType,
  NotificationResourceType,
} from '#/contexts/notification/application/public-api'

// ── Route resolver ──────────────────────────────────────────────────

export function getNotificationUrl(
  resourceType: NotificationResourceType,
  resourceId: string,
): string {
  switch (resourceType) {
    case 'inbox_item':
      return `/inbox?itemId=${resourceId}`
    case 'reply':
      return '/inbox'
    case 'goal':
      return '/properties'
    default:
      return '#'
  }
}

// ── Relative time ───────────────────────────────────────────────────

export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const now = Date.now()
  const diffMs = now - d.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)

  if (diffSec < 60) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay === 1) return 'Yesterday'
  if (diffDay < 7) return `${diffDay}d ago`

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Icon by notification type ───────────────────────────────────────

const typeIconMap: Record<string, LucideIcon> = {
  'review.created': MessageSquare,
  'feedback.created': MessageSquare,
  'reply.pending_approval': AlertTriangle,
  'reply.approved': CheckCircle,
  'reply.rejected': XCircle,
  'reply.published': Send,
  'reply.publish_failed': AlertTriangle,
  'inbox.escalated': AlertTriangle,
  'inbox.assigned': UserPlus,
  'inbox_note.added': FileEdit,
  'goal.completed': Target,
}

export function getNotificationIcon(type: NotificationType): LucideIcon {
  return typeIconMap[type] ?? Bell
}

// ── Truncate body text ──────────────────────────────────────────────

export function truncate(text: string, maxLen = 80): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen).trimEnd() + '…'
}
