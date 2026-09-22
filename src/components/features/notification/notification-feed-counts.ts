// How an optimistic write moves a cached feed head's two counts.
//
// A head carries the reader's unread count (the badge, whatever the filter)
// and its own filter's share of it (what that tab's "Mark all read" would
// change, and whether the tab offers it at all). A row action changes both by
// the rows it touches, and every touched row is loaded somewhere, so the
// loaded rows give the exact movement. "Mark all read" on a tab also reaches
// rows no one has loaded, so its movement comes from that tab's own count.

import type {
  NotificationFeedHead,
  NotificationListFilter,
  NotificationView,
} from '#/contexts/feed/application/public-api'
import { matchesNotificationFilter } from './notification-filters'

/** `null` removes the row. Returning the row unchanged is a no-op. */
export type RowPatch = (row: NotificationView) => NotificationView | null

export type FeedCounts = Pick<NotificationFeedHead, 'unreadCount' | 'filterUnreadCount'>

/** Every unread row the filter held is no longer unread, loaded or not. */
export type ClearedUnread = Readonly<{
  filter: NotificationListFilter
  /** How many unread rows that filter held. */
  held: number
}>

/** A filter whose share is every unread row, so its count is the badge. */
const holdsEveryUnread = (filter: NotificationListFilter) =>
  filter === 'all' || filter === 'unread'

const isUnreadIn = (row: NotificationView | null, filter: NotificationListFilter) =>
  row !== null && row.status === 'unread' && matchesNotificationFilter(row, filter)

/** Each loaded row once, the first copy winning: pass the heads' pages first. */
export function uniqueRows(
  rows: ReadonlyArray<NotificationView>,
): ReadonlyArray<NotificationView> {
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (seen.has(row.id)) return false
    seen.add(row.id)
    return true
  })
}

/** How the patch moves the unread rows `filter` holds among `rows`. */
export function unreadDeltaWithin(
  rows: ReadonlyArray<NotificationView>,
  patch: RowPatch,
  filter: NotificationListFilter,
): number {
  let delta = 0
  for (const row of rows) {
    delta += Number(isUnreadIn(patch(row), filter)) - Number(isUnreadIn(row, filter))
  }
  return delta
}

function patchedUnreadCount(
  unreadCount: number,
  delta: (filter: NotificationListFilter) => number,
  cleared: ClearedUnread | undefined,
): number {
  if (!cleared) return Math.max(0, unreadCount + delta('all'))
  if (holdsEveryUnread(cleared.filter)) return 0
  return Math.max(0, unreadCount - cleared.held)
}

/**
 * The counts a head of `filter` shows after the write. `delta` is the loaded
 * rows' movement within a filter; `cleared` is set for "Mark all read" and
 * "Dismiss all", whose reach is a whole filter rather than the loaded rows.
 */
export function patchedCounts(
  current: FeedCounts,
  filter: NotificationListFilter,
  delta: (filter: NotificationListFilter) => number,
  cleared?: ClearedUnread,
): FeedCounts {
  const unreadCount = patchedUnreadCount(current.unreadCount, delta, cleared)
  if (holdsEveryUnread(filter)) return { unreadCount, filterUnreadCount: unreadCount }
  if (cleared && (holdsEveryUnread(cleared.filter) || cleared.filter === filter)) {
    return { unreadCount, filterUnreadCount: 0 }
  }
  // Another tab's share: exact for a row action, an estimate from the loaded
  // rows for another tab's "Mark all read" until the invalidation reads it.
  return {
    unreadCount,
    filterUnreadCount: Math.max(0, current.filterUnreadCount + delta(filter)),
  }
}
