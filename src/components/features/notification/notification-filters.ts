// Feed filtering + grouping. Pure functions over rows the server already sent.
//
// The feed is read the way the owner chose (docs/design/notifications, D1):
// what still waits on the reader first — "Needs you" — then everything else,
// "Updates". The bell shows both, one above the other; the page offers them as
// tabs beside All. Earlier tabs (Unread, Urgent, one per category) wrapped onto
// a second line, exposed the internal category list, and were mostly empty.
// The server still answers every `NotificationListFilter`, so "Mark all read"
// and an old bookmarked filter keep their meaning; an unknown or retired
// filter in the URL opens Needs you.

import {
  isActionableNotificationType,
  isStillWaiting,
  type NotificationView,
  type NotificationListFilter,
} from '#/contexts/feed/application/public-api'
import { CATEGORY_COPY } from '#/components/features/settings/notifications-type-rows'

/**
 * `'urgent'` is the PRIORITY flag (any category); `'urgent_operational'` is the
 * category. They are different questions, hence different tabs.
 */
export type NotificationFilter = NotificationListFilter

export type NotificationFilterOption = Readonly<{
  value: NotificationFilter
  label: string
}>

export const NOTIFICATION_FILTERS: ReadonlyArray<NotificationFilterOption> = [
  { value: 'needs_you', label: 'Needs you' },
  { value: 'updates', label: 'Updates' },
  { value: 'all', label: 'All' },
]

const VALID_FILTERS: Readonly<Record<string, true>> = Object.fromEntries(
  NOTIFICATION_FILTERS.map((option) => [option.value, true]),
)

/** Coerces an untrusted search param to a tab, defaulting to Needs you. */
export function parseNotificationFilter(value: unknown): NotificationFilter {
  return typeof value === 'string' && VALID_FILTERS[value] === true
    ? (value as NotificationFilter)
    : 'needs_you'
}

/**
 * Work still waiting on its reader: an actionable notice, unread and unsettled.
 * The same rule as the server's `needs_you` filter, which the badge counts (D2).
 */
export const needsReader = (notification: NotificationView): boolean =>
  isStillWaiting(notification) && isActionableNotificationType(notification.type)

/**
 * What a filter tab holds, as a sentence subject: "Mark all read" on that tab
 * changes exactly these, and its announcement says which.
 */
export function notificationFilterScope(filter: NotificationFilter): string {
  if (filter === 'needs_you') return 'Notifications that need you'
  if (filter === 'updates') return 'Updates'
  if (filter === 'all' || filter === 'unread') return 'All notifications'
  if (filter === 'urgent') return 'Urgent notifications'
  return `${CATEGORY_COPY[filter].label} notifications`
}

export function matchesNotificationFilter(
  notification: NotificationView,
  filter: NotificationFilter,
): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'needs_you':
      return needsReader(notification)
    case 'updates':
      return !needsReader(notification)
    case 'unread':
      return isStillWaiting(notification)
    case 'urgent':
      return notification.priority === 'urgent'
    default:
      return notification.category === filter
  }
}

// ── Order and grouping ──────────────────────────────────────────────

export type NotificationGroup = Readonly<{
  key: string
  label: string
  notifications: ReadonlyArray<NotificationView>
}>

export const isOnAClock = (notification: NotificationView): boolean =>
  notification.priority === 'urgent' ||
  notification.type === 'inbox.response_target_passed'

const stampOf = (notification: NotificationView): number =>
  (notification.coalescedLatestAt ?? notification.createdAt).getTime()

/**
 * Needs you, most pressing first: what is on a clock (urgent, or past its
 * Response Target), then the rest, each newest first. Stable for equal rows.
 */
export function byUrgency(
  notifications: ReadonlyArray<NotificationView>,
): ReadonlyArray<NotificationView> {
  return [...notifications].sort(
    (a, b) => Number(isOnAClock(b)) - Number(isOnAClock(a)) || stampOf(b) - stampOf(a),
  )
}

const DAY_MS = 86_400_000
const dayFormatters = new Map<string, Intl.DateTimeFormat>()

/** The calendar day an instant falls on, on the reader's own clock. */
function dayOf(instant: number, timeZone: string): number {
  let format = dayFormatters.get(timeZone)
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    dayFormatters.set(timeZone, format)
  }
  return Date.parse(`${format.format(instant)}T00:00:00Z`) / DAY_MS
}

const DAY_GROUPS = [
  { key: 'today', label: 'Today', within: (days: number) => days <= 0 },
  { key: 'yesterday', label: 'Yesterday', within: (days: number) => days === 1 },
  { key: 'this-week', label: 'Earlier this week', within: (days: number) => days < 7 },
  { key: 'older', label: 'Older', within: () => true },
] as const

/**
 * Today / Yesterday / Earlier this week / Older, by the calendar day on the
 * reader's clock — not by 24-hour spans, so 23:50 yesterday is "Yesterday".
 * Rows keep the order they came in; empty groups are left out.
 */
export function groupByDay(
  notifications: ReadonlyArray<NotificationView>,
  timeZone: string,
  now: Date = new Date(),
): ReadonlyArray<NotificationGroup> {
  const today = dayOf(now.getTime(), timeZone)
  const buckets = DAY_GROUPS.map(() => [] as NotificationView[])
  for (const notification of notifications) {
    const days = today - dayOf(stampOf(notification), timeZone)
    const at = DAY_GROUPS.findIndex((group) => group.within(days))
    buckets[at]!.push(notification)
  }
  return DAY_GROUPS.flatMap((group, index) =>
    buckets[index]!.length === 0
      ? []
      : [{ key: group.key, label: group.label, notifications: buckets[index]! }],
  )
}
