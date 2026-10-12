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
  TriangleAlert,
  CircleX,
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

type Since = Readonly<{ unit: 'second' | 'minute' | 'hour' | 'day'; count: number }>

/** How long ago, in the largest whole unit under a week; null past a week. */
function sinceUnderAWeek(date: Date | string, now: Date): Since | null {
  const then = typeof date === 'string' ? new Date(date) : date
  const seconds = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000))
  if (seconds < MINUTE) return { unit: 'second', count: 0 }
  if (seconds < HOUR) return { unit: 'minute', count: Math.floor(seconds / MINUTE) }
  if (seconds < DAY) return { unit: 'hour', count: Math.floor(seconds / HOUR) }
  if (seconds < DAY * 7) return { unit: 'day', count: Math.floor(seconds / DAY) }
  return null
}

const dateOf = (date: Date | string, format: NotificationFormat): string =>
  dateFormatter(format.locale, format.timeZone).format(
    typeof date === 'string' ? new Date(date) : date,
  )

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
  const since = sinceUnderAWeek(date, now)
  if (since === null) return dateOf(date, format)
  // 0, never -0: "now", not "0 seconds ago".
  const count = since.unit === 'second' ? 0 : -since.count
  return relativeFormatter(format.locale).format(count, since.unit)
}

const COMPACT_UNITS = { minute: 'm', hour: 'h', day: 'd' } as const

/**
 * The row's own clock: "now", "12m", "3h", "2d", then the date. The long form
 * (`formatRelativeTime`) is what a screen reader hears; this is what fits
 * beside a one-line title. Units stay English, like every word in the product
 * (docs/BETA.md); the date past a week follows the reader's locale and zone.
 */
export function formatCompactTime(
  date: Date | string,
  format: NotificationFormat = DEFAULT_NOTIFICATION_FORMAT,
  now: Date = new Date(),
): string {
  const since = sinceUnderAWeek(date, now)
  if (since === null) return dateOf(date, format)
  if (since.unit === 'second') return 'now'
  return `${since.count}${COMPACT_UNITS[since.unit]}`
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
  // What the reader may work changed, like their role: the same permissions
  // icon. A new glyph would add a chunk to first paint, which has no headroom.
  'account.organization_property_access_changed': UserCog,
  // Somebody the reader invited arrived.
  'account.invitation_accepted': UserPlus,
  // The one irreversible account fact in the beta set — it deliberately does
  // not share the neutral shield/user icons of the other account notices.
  'account.organization_purge_pending': Trash2,
  'review.created': MessageSquare,
  'review.updated': MessageSquare,
  'feedback.created': MessageSquare,
  'reply.pending_approval': TriangleAlert,
  'reply.approved': CheckCircle,
  'reply.rejected': CircleX,
  'reply.published': Send,
  'reply.publish_failed': TriangleAlert,
  'reply.publication_cancelled': TriangleAlert,
  'inbox.escalated': TriangleAlert,
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
  'inbox.bulk_unassigned': UserMinus,
  'inbox_note.added': FileEdit,
  'portal.responsibility_needed': UserPlus,
  'portal.health_attention': TriangleAlert,
  'property.responsibility_needed': UserPlus,
  // Reviews arriving, so the same speech bubble as the rest of the review
  // family — a dedicated glyph would cost first-paint bytes for one row type.
  'property.review_import_finished': MessageSquare,
  'integration.reauthorization_required': TriangleAlert,
  'integration.google_disconnected': Unplug,
  'goal.completed': Target,
  'goal.result_revised': Target,
  // The reporter's own beta report; the same speech bubble as the Feedback entry.
  'beta_feedback.outcome': MessageSquare,
}

export function getNotificationIcon(type: NotificationType): LucideIcon {
  return typeIconMap[type] ?? Bell
}
