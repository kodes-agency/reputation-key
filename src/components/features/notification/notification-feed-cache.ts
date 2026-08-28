import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type {
  Notification,
  NotificationFeedHead,
  NotificationPage,
} from '#/contexts/notification/application/public-api'

type FeedPages = Readonly<{
  pages: ReadonlyArray<NotificationPage>
  pageParams: ReadonlyArray<number>
}>

/** `null` removes the row. Returning the row unchanged is a no-op. */
type RowPatch = (row: Notification) => Notification | null

function patchPage(page: NotificationPage, patch: RowPatch): NotificationPage {
  const notifications = page.notifications.flatMap((row) => {
    const patched = patch(row)
    return patched ? [patched] : []
  })
  return { ...page, notifications }
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
  const previousPages = qc.getQueryData<FeedPages>(listKey)
  const previousHead = qc.getQueryData<NotificationFeedHead>(headKey)
  if (!previousPages && !previousHead) return undefined

  let unreadDelta = 0
  const seen = new Set<string>()
  const cachedPages = [
    ...(previousHead ? [previousHead.page] : []),
    ...(previousPages?.pages ?? []),
  ]
  for (const page of cachedPages) {
    for (const row of page.notifications) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      const patched = patch(row)
      const wasUnread = row.status === 'unread'
      if (patched === null) {
        if (wasUnread) unreadDelta -= 1
      } else if (wasUnread !== (patched.status === 'unread')) {
        unreadDelta += wasUnread ? -1 : 1
      }
    }
  }

  if (previousHead) {
    const patchedPage = patchPage(previousHead.page, patch)
    qc.setQueryData<NotificationFeedHead>(headKey, {
      ...previousHead,
      page: options.clearContinuation ? { ...patchedPage, hasMore: false } : patchedPage,
      unreadCount:
        options.unreadCount ?? Math.max(0, previousHead.unreadCount + unreadDelta),
    })
  }

  if (previousPages) {
    const pages = previousPages.pages.map((page) => {
      const patchedPage = patchPage(page, patch)
      return options.clearContinuation ? { ...patchedPage, hasMore: false } : patchedPage
    })
    qc.setQueryData<FeedPages>(listKey, { ...previousPages, pages })
  }
  return () => {
    if (previousPages) qc.setQueryData(listKey, previousPages)
    if (previousHead) qc.setQueryData(headKey, previousHead)
  }
}
