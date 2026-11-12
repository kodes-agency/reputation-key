import { queryOptions, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { httpStatus } from '#/shared/security/expected-refusal'
import type { NotificationFeedHead } from '#/contexts/feed/application/public-api'
import {
  reconcileOlderNotifications,
  type FetchNotificationPage,
} from './notification-feed-older'

export const NOTIFICATION_POLL_INTERVAL = 30_000

/** Visibility/focus posture for the unified badge + feed-head snapshot. */
export const NOTIFICATION_POLL_OPTIONS = {
  refetchInterval: NOTIFICATION_POLL_INTERVAL,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
  staleTime: 0,
} as const

type FetchNotificationFeedHead = () => Promise<NotificationFeedHead>

/**
 * While another filter's head is read for the first time, carry the previous
 * head's unread count, but none of its rows and none of its filter's share.
 * The count is the Organization's whatever the filter, so a new query key
 * must not blank the badge or make the live region say there is nothing
 * unread; the rows and the share belong to the old filter, and would list
 * under the wrong tab and offer "Mark all read" for rows it has not read.
 */
function carryUnreadCount(
  previous: NotificationFeedHead | undefined,
): NotificationFeedHead | undefined {
  return (
    previous && {
      ...previous,
      page: { notifications: [], hasMore: false, nextCursor: null },
      filterUnreadCount: 0,
    }
  )
}

/**
 * Refusals no later tick can turn into an answer: the session ended (401), or
 * access did (403: removed from the Organization, Organization suspended,
 * in-app notices switched off; 409: the membership no longer matches). Each
 * is logged server-side, so a timer would also fill the log.
 */
const REFUSALS_THAT_STOP_POLLING: ReadonlySet<number | undefined> = new Set([
  401, 403, 409,
])

/**
 * Query options for the only notification read allowed to refresh on a timer.
 *
 * The timer stops once a read is refused for good: the session or access
 * ended under the open tab, and every tick would be another refusal. The
 * list offers sign-in (401) or Retry instead; a window focus or Retry still
 * reads again, so signing in or access restored elsewhere recovers.
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
      poll && !REFUSALS_THAT_STOP_POLLING.has(httpStatus(query.state.error))
        ? NOTIFICATION_POLL_INTERVAL
        : false,
    placeholderData: carryUnreadCount,
  })
}

/**
 * The head read, answering only once the older list under it continues it:
 * the head and the rows below it reach the screen as one consistent feed,
 * never with a row missing between them for the length of a request.
 */
export function readHeadKeepingOlderTrue(
  qc: QueryClient,
  olderKey: QueryKey,
  fetchHead: FetchNotificationFeedHead,
  fetchPage: FetchNotificationPage,
  limit: number,
): FetchNotificationFeedHead {
  return async () => {
    const head = await fetchHead()
    await reconcileOlderNotifications(qc, olderKey, head, fetchPage, limit)
    return head
  }
}
