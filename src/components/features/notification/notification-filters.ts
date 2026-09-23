// Feed filtering + grouping. Pure functions over rows the server already sent.
//
// The category tabs are derived from GOVERNING_NOTIFICATION_CATEGORIES, not
// hardcoded. `recognition` shows as "Goals", the goal results it governs
// (ADR 0046, amended 2026-09-22). `mandatory` DOES govern types
// now (Organization access granted/removed, role changed, purge pending), so
// it earns a tab: a category the reader cannot switch off is still one they
// may filter to. One list per question, both from the domain.

import {
  GOVERNING_NOTIFICATION_CATEGORIES,
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

/**
 * What a filter tab holds, as a sentence subject: "Mark all read" on that tab
 * changes exactly these, and its announcement says which.
 */
export function notificationFilterScope(filter: NotificationFilter): string {
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
  notifications: ReadonlyArray<NotificationView>
}>

/** Popover grouping: what still needs attention, then everything else. */
export function groupByReadState(
  notifications: ReadonlyArray<NotificationView>,
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
 * UUID is not a group heading. Organization account notices form their own
 * stable group rather than inventing a Property.
 */
export function groupByProperty(
  notifications: ReadonlyArray<NotificationView>,
  propertyNames: Readonly<Record<string, string>>,
): ReadonlyArray<NotificationGroup> {
  const order: string[] = []
  const buckets = new Map<string, NotificationView[]>()
  const organizationKey = 'organization-account-security'

  for (const notification of notifications) {
    const key = notification.propertyId ?? organizationKey
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
      label:
        key === organizationKey
          ? 'Account and security'
          : (propertyNames[key] ?? rows[0]?.payload.propertyName ?? 'Unnamed property'),
      notifications: rows,
    }
  })
}
