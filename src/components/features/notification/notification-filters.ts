// Feed filtering + grouping. Pure functions over rows the server already sent.
//
// The bell and the page offer two tabs: All and Unread. They used to add
// Urgent and one tab per category (Account, Action, Workflow, Goals), which
// wrapped onto a second line in the popover and on a phone, exposed the
// internal category list rather than a question a reader asks, and were
// mostly empty: Account and Goals rarely hold anything, and Urgent overlapped
// Action. The server still answers every `NotificationListFilter`, so "Mark all
// read" and an old bookmarked filter keep their meaning; an unknown or retired
// filter in the URL falls back to All.

import {
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
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
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
      return isStillWaiting(notification)
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

/**
 * Popover grouping: what still needs attention, then everything else. A
 * settled row is still unread but asks for nothing, so it is "Earlier".
 */
export function groupByReadState(
  notifications: ReadonlyArray<NotificationView>,
): ReadonlyArray<NotificationGroup> {
  const unread = notifications.filter(isStillWaiting)
  const read = notifications.filter((n) => !isStillWaiting(n))
  const groups: NotificationGroup[] = []
  if (unread.length > 0) groups.push({ key: 'new', label: 'New', notifications: unread })
  if (read.length > 0)
    groups.push({ key: 'earlier', label: 'Earlier', notifications: read })
  return groups
}

// Rows with no Property belong to the Organization. Access and role notices
// (mandatory) are the security group; the other Organization notices (a
// disconnected Google account, a beta report's outcome, ADR 0059) are work,
// and must not read as security.
const ORGANIZATION_GROUP_LABELS: ReadonlyMap<string, string> = new Map([
  ['organization-account-security', 'Account and security'],
  ['organization', 'Organization'],
])

function groupKeyOf(notification: NotificationView): string {
  if (notification.propertyId !== null) return notification.propertyId
  return notification.category === 'mandatory'
    ? 'organization-account-security'
    : 'organization'
}

/**
 * Page grouping. The label resolves from the properties the route already
 * loaded, then from the row's own payload — never from `propertyId`, because a
 * UUID is not a group heading. Organization notices form their own stable
 * groups rather than inventing a Property.
 */
export function groupByProperty(
  notifications: ReadonlyArray<NotificationView>,
  propertyNames: Readonly<Record<string, string>>,
): ReadonlyArray<NotificationGroup> {
  const order: string[] = []
  const buckets = new Map<string, NotificationView[]>()

  for (const notification of notifications) {
    const key = groupKeyOf(notification)
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
        ORGANIZATION_GROUP_LABELS.get(key) ??
        propertyNames[key] ??
        rows[0]?.payload.propertyName ??
        'Unnamed property',
      notifications: rows,
    }
  })
}
