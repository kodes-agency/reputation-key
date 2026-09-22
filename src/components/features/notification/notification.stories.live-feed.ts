// Test-only harness: an in-memory notification feed that changes between
// requests, observed through the REAL QueryObservers useNotifications builds.
// The `.stories.` segment keeps this module out of production-shaped source
// inventories and bundles, like notification.stories.fixtures.ts.
//
// No React: the unit project is node-only, so the observers are driven
// directly, exactly as the hook configures them.

import {
  InfiniteQueryObserver,
  QueryObserver,
  type QueryClient,
} from '@tanstack/react-query'
import { notificationKeys } from '#/shared/queries/query-keys'
import type { NotificationFeedCursor } from '#/contexts/feed/application/public-api'
import {
  makeNotification,
  notificationPageFixture,
} from './notification.stories.fixtures'
import {
  fetchHeadKeepingHistoryContiguous,
  mergeNotificationHeadWithHistory,
  notificationHeadQueryOptions,
  notificationHistoryQueryOptions,
} from './notification-feed-pagination'

export const LIVE_FEED_LIMIT = 20
const FEED_START = Date.parse('2026-09-01T12:00:00.000Z')

const feedRowId = (series: 1 | 2, n: number) =>
  `${series}0000000-0000-4000-8000-${n.toString().padStart(12, '0')}`

/** An in-memory feed, newest first, that the scenario can change between requests. */
export function createLiveFeed(size: number) {
  const labels = new Map<string, string>()
  const requests: string[] = []
  const row = (series: 1 | 2, n: number, label: string, at: number) => {
    const id = feedRowId(series, n)
    labels.set(id, label)
    return makeNotification({ id, createdAt: new Date(at) })
  }
  let rows = Array.from({ length: size }, (_, n) =>
    row(1, n, `R${n}`, FEED_START - n * 60_000),
  )
  let arrivals = 0
  // While held, a head request is answered with the feed as it was when the
  // request was made, and only once released: a read in flight.
  let heldHeads: Array<() => void> | null = null
  let pagesFail = false

  const label = (id: string) => labels.get(id) ?? id
  const pageOf = (candidates: typeof rows) =>
    notificationPageFixture(
      candidates.slice(0, LIVE_FEED_LIMIT),
      candidates.length > LIVE_FEED_LIMIT,
    )
  // Served like the endpoint: rows strictly after the cursor in feed order,
  // which is latest activity (a coalesced row's newest event) first.
  const activityAt = (current: (typeof rows)[number]) =>
    (current.coalescedLatestAt ?? current.createdAt).getTime()
  const after = (cursor: NotificationFeedCursor) => {
    const at = Date.parse(cursor.at.replace(/(\.\d{3})\d{3}Z$/, '$1Z'))
    return rows.filter(
      (current) =>
        activityAt(current) < at ||
        (activityAt(current) === at && current.id < cursor.id),
    )
  }

  return {
    requests,
    label,
    labels: () => rows.map((current) => label(current.id)),
    arrive: (count: number) => {
      for (let k = 0; k < count; k += 1) {
        arrivals += 1
        const arrival = row(2, arrivals, `N${arrivals}`, FEED_START + arrivals * 60_000)
        rows = [arrival, ...rows]
      }
    },
    remove: (removed: string) => {
      rows = rows.filter((current) => label(current.id) !== removed)
    },
    // A repeat event absorbed by an existing row: it re-sorts to the top.
    coalesce: (repeated: string) => {
      arrivals += 1
      const bumped = rows.find((current) => label(current.id) === repeated)
      if (!bumped) throw new Error(`no row ${repeated} in the live feed`)
      rows = [
        {
          ...bumped,
          coalescedCount: bumped.coalescedCount + 1,
          coalescedLatestAt: new Date(FEED_START + arrivals * 60_000),
        },
        ...rows.filter((current) => current !== bumped),
      ]
    },
    // What another tab, or the other surface in this one, does to the feed.
    markAllRead: () => {
      rows = rows.map((current) => ({ ...current, status: 'read' as const }))
    },
    dismissAll: () => {
      rows = []
    },
    failPages: () => {
      pagesFail = true
    },
    holdHeads: () => {
      heldHeads = []
    },
    releaseHeads: () => {
      const waiting = heldHeads ?? []
      heldHeads = null
      for (const answer of waiting) answer()
    },
    head: async () => {
      requests.push('head')
      const answer = {
        page: pageOf(rows),
        unreadCount: rows.filter((current) => current.status === 'unread').length,
        watermark: 'live-feed',
      }
      const waiting = heldHeads
      if (waiting) await new Promise<void>((resolve) => waiting.push(resolve))
      return answer
    },
    pageAfter: async (before: NotificationFeedCursor | null) => {
      requests.push(before ? `after ${label(before.id)}` : 'top')
      if (pagesFail) throw new Error('page read failed')
      return pageOf(before ? after(before) : rows)
    },
  }
}

/** The observers useNotifications builds, without React. */
export function observeLiveFeed(
  client: QueryClient,
  feed: ReturnType<typeof createLiveFeed>,
) {
  const historyKey = notificationKeys.list('org-1', LIVE_FEED_LIMIT, 'all')
  const headKey = notificationKeys.head('org-1', LIVE_FEED_LIMIT, 'all')
  const headObserver = new QueryObserver(
    client,
    notificationHeadQueryOptions(
      headKey,
      fetchHeadKeepingHistoryContiguous(
        client,
        headKey,
        historyKey,
        feed.head,
        feed.pageAfter,
      ),
      true,
    ),
  )
  const historyOptions = () =>
    notificationHistoryQueryOptions(
      historyKey,
      feed.pageAfter,
      headObserver.getCurrentResult().data?.page.nextCursor ?? null,
    )
  const historyObserver = new InfiniteQueryObserver(client, historyOptions())
  const unsubscribeHead = headObserver.subscribe(() => {})
  const unsubscribeHistory = historyObserver.subscribe(() => {})

  return {
    // A render always precedes the click, so the options carry the current
    // head's cursor exactly as the hook's would.
    loadMore: () => {
      historyObserver.setOptions(historyOptions())
      return historyObserver.fetchNextPage()
    },
    visible: () =>
      mergeNotificationHeadWithHistory(
        headObserver.getCurrentResult().data?.page,
        historyObserver.getCurrentResult().data?.pages,
      ).map((row) => feed.label(row.id)),
    unreadVisible: () =>
      mergeNotificationHeadWithHistory(
        headObserver.getCurrentResult().data?.page,
        historyObserver.getCurrentResult().data?.pages,
      )
        .filter((row) => row.status === 'unread')
        .map((row) => feed.label(row.id)),
    historyPageCount: () => historyObserver.getCurrentResult().data?.pages.length ?? 0,
    headError: () => headObserver.getCurrentResult().error,
    stop: () => {
      unsubscribeHead()
      unsubscribeHistory()
    },
  }
}
