// Notification UI utilities — PRESENTATIONAL ONLY.
//
// Copy and deep links are NOT here. `renderNotification` / `notificationLink`
// in the notification domain are the single renderer for every channel
// (in-app row, email, digest), so a sentence fixed there is fixed everywhere.
// This module holds the two things that are genuinely view concerns: which
// icon a type gets, and how a timestamp reads in the user's own locale.

import {
  Award,
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
import type { NotificationType } from '#/contexts/notification/application/public-api'

// ── Locale-aware timestamps ─────────────────────────────────────────
//
// The user's `locale` and `timezone` are persisted on NotificationUserSettings
// and the settings page advertises them as "used for notification formatting",
// so they are used here rather than a hardcoded 'en-US'. Until the settings
// query resolves we format with DEFAULT_FORMAT — a fixed value, not the
// browser's, so the server and the first client render agree.

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

/** Absolute timestamp for the row's `title`/`dateTime` affordances. */
export function formatAbsoluteTime(
  date: Date | string,
  format: NotificationFormat = DEFAULT_NOTIFICATION_FORMAT,
): string {
  const then = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat(format.locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: format.timeZone,
  }).format(then)
}

// ── Icon by notification type ───────────────────────────────────────

const typeIconMap: Record<NotificationType, LucideIcon> = {
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
  'badge.awarded': Award,
}

export function getNotificationIcon(type: NotificationType): LucideIcon {
  return typeIconMap[type] ?? Bell
}
