import { queryOptions, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { httpStatus } from '#/shared/security/expected-refusal'
import {
  isNewerFeedPosition,
  type NotificationFeedCursor,
  type NotificationFeedHead,
  type NotificationView,
  type NotificationPage,
} from '#/contexts/feed/application/public-api'

export const NOTIFICATION_POLL_INTERVAL = 30_000

/** Visibility/focus posture for the unified badge + feed-head snapshot. */
export const NOTIFICATION_POLL_OPTIONS = {
  refetchInterval: NOTIFICATION_POLL_INTERVAL,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
  staleTime: 0,
} as const

type FetchNotificationPage = (
  before: NotificationFeedCursor | null,
) => Promise<NotificationPage>
type FetchNotificationFeedHead = () => Promise<NotificationFeedHead>

/** Loaded history as the query cache holds it: each page and the cursor it continued from. */
export type NotificationHistoryPages = Readonly<{
  pages: ReadonlyArray<NotificationPage>
  pageParams: ReadonlyArray<NotificationFeedCursor | null>
}>

const NO_ROWS_YET: NotificationPage = {
  notifications: [],
  hasMore: false,
  nextCursor: null,
}

/**
 * While another filter's head is read for the first time, carry the previous
 * head's unread count, but none of its rows. The count is the Organization's
 * whatever the filter, so a new query key must not blank the badge or make
 * the live region say there is nothing unread; the rows belong to the old
 * filter and would be listed under the wrong tab.
 */
function carryUnreadCount(
  previous: NotificationFeedHead | undefined,
): NotificationFeedHead | undefined {
  return previous && { ...previous, page: NO_ROWS_YET }
}

/**
 * Query options for the only notification page allowed to refresh on a timer.
 *
 * The timer stops once a read answers 401: the session ended under the open
 * tab (signed out elsewhere, expired, or revoked by a password change), and
 * every tick would be another refusal. The list offers sign-in instead; a
 * window focus or Retry still reads again, so signing in elsewhere recovers.
 */
export function notificationHeadQueryOptions(
  queryKey: QueryKey,
  fetchHead: FetchNotificationFeedHead,
  poll: boolean,
) {
  return queryOptions<NotificationFeedHead, Error, NotificationFeedHead, QueryKey>({
    queryKey,
    queryFn: fetchHead,
    ...NOTIFICATION_POLL_OPTIONS,
    refetchInterval: (query) =>
      poll && httpStatus(query.state.error) !== 401 ? NOTIFICATION_POLL_INTERVAL : false,
    placeholderData: carryUnreadCount,
  })
}

/**
 * Older notification pages are fetched only on an explicit `fetchNextPage`.
 * Keeping this query disabled also prevents focus and feed invalidations from
 * replaying every page already in memory.
 *
 * Pages are keyset pages. The first continues strictly after the head's last
 * row (`headCursor`), each later one after the previous page's last row, so a
 * row arriving or leaving above a page can neither shift it nor make the next
 * "Load more" skip a row.
 */
export function notificationHistoryQueryOptions(
  queryKey: QueryKey,
  fetchPage: FetchNotificationPage,
  headCursor: NotificationFeedCursor | null,
) {
  return {
    queryKey,
    queryFn: ({ pageParam }: { pageParam: NotificationFeedCursor | null }) =>
      fetchPage(pageParam),
    initialPageParam: headCursor,
    getNextPageParam: (lastPage: NotificationPage) =>
      lastPage.hasMore ? lastPage.nextCursor : null,
    enabled: false,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  } as const
}

/**
 * True when a refreshed head no longer reaches the first loaded history page.
 * The head is a bounded page: rows arriving above it, or a coalesced row
 * re-sorting to the top, push rows out of it, and those rows are then in
 * neither cache. A head that only shrank still overlaps history.
 */
function isHistoryDetached(
  head: NotificationPage,
  historyStart: NotificationFeedCursor | null | undefined,
): boolean {
  if (!historyStart || !head.hasMore || !head.nextCursor) return false
  return isNewerFeedPosition(head.nextCursor, historyStart)
}

/**
 * True when a refreshed head proves loaded history stale. History is never
 * re-read (it would replay every page), so a change made in another tab, or
 * on the other surface before this one loaded it, stays in it. Two answers of
 * the head expose such a change without another request:
 *
 *  - the head is the whole feed (`hasMore` off), so nothing below it exists
 *    and every history row is either shown by the head or gone;
 *  - the rows on screen hold more unread than the Organization-wide unread
 *    count, so some of them were read, dismissed or muted since loading: the
 *    "New" rows a badge of 0 would contradict.
 */
function isHistoryStale(
  head: NotificationFeedHead,
  pages: ReadonlyArray<NotificationPage>,
): boolean {
  if (!head.page.hasMore) return true
  const unread = mergeNotificationHeadWithHistory(head.page, pages).filter(
    (row) => row.status === 'unread',
  )
  return unread.length > head.unreadCount
}

/**
 * The head fetch, keeping loaded history contiguous with it and true to it.
 * When a refreshed head no longer reaches loaded history, or proves it stale,
 * that history is reset, so the list shows the head alone and "Load more"
 * continues from the head's own cursor rather than leaving a silent gap in
 * the middle of the list or rows the server has since changed.
 *
 * A read the head was written to during (an optimistic write, which also
 * cancels it) describes the feed from before that write, so it changes
 * nothing: not the head, and not loaded history. The write count is compared
 * rather than the query's abort signal, because reading that signal makes the
 * query cancel itself whenever its last observer unmounts mid-read.
 */
export function fetchHeadKeepingHistoryContiguous(
  qc: QueryClient,
  headKey: QueryKey,
  historyKey: QueryKey,
  fetchHead: FetchNotificationFeedHead,
): FetchNotificationFeedHead {
  const headWrites = () => qc.getQueryState(headKey)?.dataUpdateCount ?? 0
  return async () => {
    const writesBefore = headWrites()
    const head = await fetchHead()
    if (headWrites() !== writesBefore) return head
    const history = qc.getQueryData<NotificationHistoryPages>(historyKey)
    if (
      history &&
      (isHistoryDetached(head.page, history.pageParams[0]) ||
        isHistoryStale(head, history.pages))
    ) {
      await qc.resetQueries({ queryKey: historyKey, exact: true })
    }
    return head
  }
}

/**
 * The refreshed head wins for an overlapping id, while every older row that
 * the user already loaded remains visible exactly once.
 */
export function mergeNotificationHeadWithHistory(
  head: NotificationPage | undefined,
  historyPages: ReadonlyArray<NotificationPage> = [],
): ReadonlyArray<NotificationView> {
  const notifications: NotificationView[] = []
  const seen = new Set<string>()

  for (const page of head ? [head, ...historyPages] : historyPages) {
    for (const notification of page.notifications) {
      if (seen.has(notification.id)) continue
      seen.add(notification.id)
      notifications.push(notification)
    }
  }

  return notifications
}
