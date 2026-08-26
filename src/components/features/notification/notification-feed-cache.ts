import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type {
  Notification,
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
  countKey: QueryKey,
  patch: RowPatch,
  options: Readonly<{ clearContinuation?: boolean }> = {},
): (() => void) | undefined {
  const previousPages = qc.getQueryData<FeedPages>(listKey)
  const previousHead = qc.getQueryData<NotificationPage>(headKey)
  if (!previousPages && !previousHead) return undefined
  const previousCount = qc.getQueryData<{ count: number }>(countKey)

  let unreadDelta = 0
  const seen = new Set<string>()
  const cachedPages = [
    ...(previousHead ? [previousHead] : []),
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
    const patchedHead = patchPage(previousHead, patch)
    qc.setQueryData<NotificationPage>(
      headKey,
      options.clearContinuation ? { ...patchedHead, hasMore: false } : patchedHead,
    )
  }

  if (previousPages) {
    const pages = previousPages.pages.map((page) => {
      const patchedPage = patchPage(page, patch)
      return options.clearContinuation ? { ...patchedPage, hasMore: false } : patchedPage
    })
    qc.setQueryData<FeedPages>(listKey, { ...previousPages, pages })
  }
  if (previousCount && unreadDelta !== 0) {
    qc.setQueryData(countKey, { count: Math.max(0, previousCount.count + unreadDelta) })
  }

  return () => {
    if (previousPages) qc.setQueryData(listKey, previousPages)
    if (previousHead) qc.setQueryData(headKey, previousHead)
    if (previousCount) qc.setQueryData(countKey, previousCount)
  }
}
