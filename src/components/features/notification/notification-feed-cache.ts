import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type {
  NotificationView,
  NotificationFeedHead,
  NotificationListFilter,
  NotificationPage,
} from '#/contexts/feed/application/public-api'
import { notificationKeys } from '#/shared/queries/query-keys'
import { matchesNotificationFilter } from './notification-filters'
import type { NotificationHistoryPages } from './notification-feed-pagination'

type FeedPages = NotificationHistoryPages
type CachedFeed = NotificationFeedHead | FeedPages

/** `null` removes the row. Returning the row unchanged is a no-op. */
type RowPatch = (row: NotificationView) => NotificationView | null

function patchPage(page: NotificationPage, patch: RowPatch): NotificationPage {
  const notifications = page.notifications.flatMap((row) => {
    const patched = patch(row)
    return patched ? [patched] : []
  })
  return { ...page, notifications }
}

/** `clearContinuation` pins `hasMore` off so a drained feed stops paginating. */
function patchCachedPage(
  page: NotificationPage,
  patch: RowPatch,
  clearContinuation: boolean | undefined,
): NotificationPage {
  const patched = patchPage(page, patch)
  return clearContinuation ? { ...patched, hasMore: false } : patched
}

/** How one row moves the unread tally: `-1` read/removed, `+1` unread, else `0`. */
function rowUnreadDelta(row: NotificationView, patched: NotificationView | null): number {
  const wasUnread = row.status === 'unread'
  if (patched === null) return wasUnread ? -1 : 0
  if (wasUnread === (patched.status === 'unread')) return 0
  return wasUnread ? -1 : 1
}

/**
 * Sum the unread movement across the de-duplicated union of the supplied pages,
 * so a row held by several caches (a head/history boundary, or the bell and
 * the page) is counted exactly once.
 */
function unreadDeltaAcross(
  pages: ReadonlyArray<NotificationPage>,
  patch: RowPatch,
): number {
  const seen = new Set<string>()
  let delta = 0
  for (const page of pages) {
    for (const row of page.notifications) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      delta += rowUnreadDelta(row, patch(row))
    }
  }
  return delta
}

const isHistory = (data: CachedFeed): data is FeedPages => 'pages' in data
const pagesOf = (data: CachedFeed): ReadonlyArray<NotificationPage> =>
  isHistory(data) ? data.pages : [data.page]

/** The filter a feed key was read under: `list(org, limit, filter)`, and its head. */
function filterOf(queryKey: QueryKey): NotificationListFilter {
  const identity = queryKey.find(
    (part): part is Readonly<{ filter: NotificationListFilter }> =>
      typeof part === 'object' && part !== null && 'filter' in part,
  )
  return identity?.filter ?? 'all'
}

/** The patch as one cache sees it: a changed row that left its filter leaves it. */
function patchWithin(filter: NotificationListFilter, patch: RowPatch): RowPatch {
  return (row) => {
    const patched = patch(row)
    if (patched === null || patched === row) return patched
    return matchesNotificationFilter(patched, filter) ? patched : null
  }
}

/**
 * Optimistically patch every cached feed of the Organization: the bell's and
 * the page's heads and loaded history pages, for every filter. Patching only
 * the surface that acted left the other one's history (disabled, so never
 * refetched) showing rows the server had already changed. The unread count is
 * the Organization's, not the filter's, so one delta, taken over the
 * de-duplicated union of every cached row, moves every head. The returned
 * thunk restores every touched cache on failure.
 */
export function patchNotificationFeedCache(
  qc: QueryClient,
  organizationId: string,
  patch: RowPatch,
  options: Readonly<{
    clearContinuation?: boolean
    unreadCount?: number
  }> = {},
): (() => void) | undefined {
  // A read already in flight (opening the bell starts one, and so does every
  // poll) answers with the feed from before this write, and would land on top
  // of it: the badge would go 5 → 0 → 5 → 0. Cancelling reverts that query to
  // its last settled data synchronously, so the patch below applies to it, and
  // the success invalidation reads the server again afterwards. A query with
  // no data yet has nothing to protect and keeps its first read.
  void qc.cancelQueries({
    queryKey: notificationKeys.feed(organizationId),
    predicate: (query) => query.state.data !== undefined,
  })
  const previous = qc
    .getQueriesData<CachedFeed>({ queryKey: notificationKeys.lists(organizationId) })
    .flatMap(([key, data]) => (data ? [{ key, data }] : []))
  if (previous.length === 0) return undefined

  // Heads first: the freshest copy of a row decides its delta.
  const heads = previous.filter((entry) => !isHistory(entry.data))
  const histories = previous.filter((entry) => isHistory(entry.data))
  const unreadDelta = unreadDeltaAcross(
    [...heads, ...histories].flatMap((entry) => pagesOf(entry.data)),
    patch,
  )

  for (const { key, data } of previous) {
    const within = patchWithin(filterOf(key), patch)
    const patchOne = (page: NotificationPage) =>
      patchCachedPage(page, within, options.clearContinuation)
    if (isHistory(data)) {
      qc.setQueryData<FeedPages>(key, { ...data, pages: data.pages.map(patchOne) })
      continue
    }
    qc.setQueryData<NotificationFeedHead>(key, {
      ...data,
      page: patchOne(data.page),
      unreadCount: options.unreadCount ?? Math.max(0, data.unreadCount + unreadDelta),
    })
  }
  return () => {
    for (const { key, data } of previous) qc.setQueryData(key, data)
  }
}
