// Feed filtering + grouping. Pure functions over rows the server already sent.
//
// The category tabs are derived from GOVERNING_NOTIFICATION_CATEGORIES, not
// hardcoded: `mandatory` governs zero notification types today, so a
// "mandatory" tab could only ever render an empty list — while the SETTINGS
// page still has to show that category (ADR 0046 reserves it for
// account/security/legal). One list per question, both from the domain.

import {
  GOVERNING_NOTIFICATION_CATEGORIES,
  type Notification,
  type NotificationCategory,
} from '#/contexts/notification/application/public-api'
import { CATEGORY_COPY } from '#/components/features/settings/notifications-type-rows'

/**
 * `'urgent'` is the PRIORITY flag (any category); `'urgent_operational'` is the
 * category. They are different questions, hence different tabs.
 */
export type NotificationFilter = 'all' | 'unread' | 'urgent' | NotificationCategory

export type NotificationFilterOption = Readonly<{
  value: NotificationFilter
  label: string
}>

export const NOTIFICATION_FILTERS: ReadonlyArray<NotificationFilterOption> = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'urgent', label: 'Urgent' },
  ...GOVERNING_NOTIFICATION_CATEGORIES.map((category) => ({
    value: category,
    label: CATEGORY_COPY[category].shortLabel,
  })),
]

const VALID_FILTERS: Readonly<Record<string, true>> = Object.fromEntries(
  NOTIFICATION_FILTERS.map((option) => [option.value, true]),
)

/** Coerces an untrusted search param to a filter, defaulting to `'all'`. */
export function parseNotificationFilter(value: unknown): NotificationFilter {
  return typeof value === 'string' && VALID_FILTERS[value] === true
    ? (value as NotificationFilter)
    : 'all'
}

export function matchesNotificationFilter(
  notification: Notification,
  filter: NotificationFilter,
): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'unread':
      return notification.status === 'unread'
    case 'urgent':
      return notification.priority === 'urgent'
    default:
      return notification.category === filter
  }
}

// ── Grouping ────────────────────────────────────────────────────────

export type NotificationGroup = Readonly<{
  key: string
  label: string
  notifications: ReadonlyArray<Notification>
}>

/** Popover grouping: what still needs attention, then everything else. */
export function groupByReadState(
  notifications: ReadonlyArray<Notification>,
): ReadonlyArray<NotificationGroup> {
  const unread = notifications.filter((n) => n.status === 'unread')
  const read = notifications.filter((n) => n.status !== 'unread')
  const groups: NotificationGroup[] = []
  if (unread.length > 0) groups.push({ key: 'new', label: 'New', notifications: unread })
  if (read.length > 0)
    groups.push({ key: 'earlier', label: 'Earlier', notifications: read })
  return groups
}

/**
 * Page grouping. The label resolves from the properties the route already
 * loaded, then from the row's own payload — never from `propertyId`, because a
 * UUID is not a group heading.
 */
export function groupByProperty(
  notifications: ReadonlyArray<Notification>,
  propertyNames: Readonly<Record<string, string>>,
): ReadonlyArray<NotificationGroup> {
  const order: string[] = []
  const buckets = new Map<string, Notification[]>()

  for (const notification of notifications) {
    const key = notification.propertyId
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.push(notification)
      continue
    }
    order.push(key)
    buckets.set(key, [notification])
  }

  return order.map((key) => {
    const rows = buckets.get(key) ?? []
    return {
      key,
      label: propertyNames[key] ?? rows[0]?.payload.propertyName ?? 'Unnamed property',
      notifications: rows,
    }
  })
}
