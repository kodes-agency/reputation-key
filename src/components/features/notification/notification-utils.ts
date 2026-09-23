// Notification UI utilities — PRESENTATIONAL ONLY.
//
// Copy and deep links are NOT here. `renderNotification` / `notificationLink`
// in the notification domain are the single renderer for every channel
// (in-app row, email, digest), so a sentence fixed there is fixed everywhere.
// This module holds the two things that are genuinely view concerns: which
// icon a type gets, and how a timestamp reads in the user's own locale.

import { formatDateTime } from '#/lib/format-date-time'
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
  ShieldCheck,
  UserCog,
  UserMinus,
  Trash2,
  Clock,
  Unplug,
  type LucideIcon,
} from 'lucide-react'
import type { NotificationType } from '#/contexts/feed/application/public-api'

// ── Locale-aware timestamps ─────────────────────────────────────────
//
// Timestamps use the same language and timezone as delivery: the user's saved
// settings, with their Organization's timezone when they never chose one
// (ADR 0046 r.3; the settings server function resolves it). Until that query
// resolves we format with DEFAULT_FORMAT — a fixed value, not the browser's,
// so the server and the first client render agree — and the absolute time
// names its zone, so a fallback UTC tooltip says so.

export type NotificationFormat = Readonly<{ locale: string; timeZone: string }>

export const DEFAULT_NOTIFICATION_FORMAT: NotificationFormat = {
  locale: 'en-US',
  timeZone: 'UTC',
}

const MINUTE = 60
const HOUR = MINUTE * 60
const DAY = HOUR * 24

/** Intl instances are expensive to build; one per (locale, timeZone) is plenty. */
const relativeCache = new Map<string, Intl.RelativeTimeFormat>()
const dateCache = new Map<string, Intl.DateTimeFormat>()

const relativeFormatter = (locale: string): Intl.RelativeTimeFormat => {
  const cached = relativeCache.get(locale)
  if (cached) return cached
  const created = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  relativeCache.set(locale, created)
  return created
}

const dateFormatter = (locale: string, timeZone: string): Intl.DateTimeFormat => {
  const key = `${locale}|${timeZone}`
  const cached = dateCache.get(key)
  if (cached) return cached
  const created = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone,
  })
  dateCache.set(key, created)
  return created
}

/**
 * "just now" / "3 hours ago" / "yesterday" / "Mar 4". Anything older than a
 * week becomes an absolute date in the user's timezone, because "23d ago" is
 * not information anyone acts on.
 */
export function formatRelativeTime(
  date: Date | string,
  format: NotificationFormat = DEFAULT_NOTIFICATION_FORMAT,
  now: Date = new Date(),
): string {
  const then = typeof date === 'string' ? new Date(date) : date
  const seconds = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000))

  if (seconds < MINUTE) return relativeFormatter(format.locale).format(0, 'second')
  if (seconds < HOUR) {
    return relativeFormatter(format.locale).format(
      -Math.floor(seconds / MINUTE),
      'minute',
    )
  }
  if (seconds < DAY) {
    return relativeFormatter(format.locale).format(-Math.floor(seconds / HOUR), 'hour')
  }
  if (seconds < DAY * 7) {
    return relativeFormatter(format.locale).format(-Math.floor(seconds / DAY), 'day')
  }
  return dateFormatter(format.locale, format.timeZone).format(then)
}

/** Absolute timestamp, zone named, for the row's `title`/`dateTime` affordances. */
export function formatAbsoluteTime(
  date: Date | string,
  format: NotificationFormat = DEFAULT_NOTIFICATION_FORMAT,
): string {
  const then = typeof date === 'string' ? new Date(date) : date
  return formatDateTime(then, {
    locale: format.locale,
    timeZone: format.timeZone,
    timeZoneName: true,
  })
}

// ── Icon by notification type ───────────────────────────────────────

const typeIconMap: Record<NotificationType, LucideIcon> = {
  'account.organization_access_granted': ShieldCheck,
  'account.organization_role_changed': UserCog,
  'account.organization_access_removed': UserMinus,
  // The one irreversible account fact in the beta set — it deliberately does
  // not share the neutral shield/user icons of the other account notices.
  'account.organization_purge_pending': Trash2,
  'review.created': MessageSquare,
  'review.updated': MessageSquare,
  'feedback.created': MessageSquare,
  'reply.pending_approval': AlertTriangle,
  'reply.approved': CheckCircle,
  'reply.rejected': XCircle,
  'reply.published': Send,
  'reply.publish_failed': AlertTriangle,
  'reply.publication_cancelled': AlertTriangle,
  'inbox.escalated': AlertTriangle,
  'inbox.escalation_resolved': CheckCircle,
  'inbox.reopened': MessageSquare,
  'inbox.bulk_reopened': MessageSquare,
  'inbox.response_target_halfway': Clock,
  'inbox.response_target_passed': Clock,
  'inbox.assigned': UserPlus,
  'inbox.bulk_assigned': UserPlus,
  'inbox.assignments_released': UserMinus,
  // The mirror of an assignment: the work left this reader's list.
  'inbox.unassigned': UserMinus,
  'inbox_note.added': FileEdit,
  'portal.responsibility_needed': UserPlus,
  'portal.health_attention': AlertTriangle,
  'property.responsibility_needed': UserPlus,
  'integration.reauthorization_required': AlertTriangle,
  'integration.google_disconnected': Unplug,
  'goal.completed': Target,
  'goal.result_revised': Target,
  // The reporter's own beta report; the same speech bubble as the Feedback entry.
  'beta_feedback.outcome': MessageSquare,
}

export function getNotificationIcon(type: NotificationType): LucideIcon {
  return typeIconMap[type] ?? Bell
}
