import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type {
  NotificationView,
  NotificationFeedHead,
  NotificationPage,
} from '#/contexts/feed/application/public-api'
import type { NotificationHistoryPages } from './notification-feed-pagination'

type FeedPages = NotificationHistoryPages

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
 * so a row on the head/history boundary is counted exactly once.
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

/**
 * Optimistically patch the refreshed head and every loaded history page. The
 * unread count is derived from their de-duplicated union, so a boundary row is
 * counted once. The returned thunk restores every touched cache on failure.
 */
export function patchNotificationFeedCache(
  qc: QueryClient,
  listKey: QueryKey,
  headKey: QueryKey,
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
  // the success invalidation reads the server again afterwards.
  void qc.cancelQueries({ queryKey: listKey })
  const previousPages = qc.getQueryData<FeedPages>(listKey)
  const previousHead = qc.getQueryData<NotificationFeedHead>(headKey)
  if (!previousPages && !previousHead) return undefined

  const unreadDelta = unreadDeltaAcross(
    [...(previousHead ? [previousHead.page] : []), ...(previousPages?.pages ?? [])],
    patch,
  )

  if (previousHead) {
    qc.setQueryData<NotificationFeedHead>(headKey, {
      ...previousHead,
      page: patchCachedPage(previousHead.page, patch, options.clearContinuation),
      unreadCount:
        options.unreadCount ?? Math.max(0, previousHead.unreadCount + unreadDelta),
    })
  }

  if (previousPages) {
    const pages = previousPages.pages.map((page) =>
      patchCachedPage(page, patch, options.clearContinuation),
    )
    qc.setQueryData<FeedPages>(listKey, { ...previousPages, pages })
  }
  return () => {
    if (previousPages) qc.setQueryData(listKey, previousPages)
    if (previousHead) qc.setQueryData(headKey, previousHead)
  }
}
