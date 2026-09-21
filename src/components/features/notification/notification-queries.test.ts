// The bell's polling posture, asserted through a REAL QueryObserver rather
// than by reading the options back.
//
// What this defends: `refetchIntervalInBackground: false` is the library
// default, so a reviewer cannot tell from the diff whether the "don't poll a
// hidden tab" behaviour is intentional or accidental. Setting it to `true` —
// or dropping `staleTime: 0`, which is what makes the on-focus refetch
// immediate — silently puts every logged-in background tab back on a 30s
// request loop against the server function. These tests fail if either
// happens.
//
// No React here: the unit project is node-only and has no `.test.tsx` support,
// so the shared options object is exercised directly on the observer the hooks
// would build.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  InfiniteQueryObserver,
  QueryClient,
  QueryObserver,
  environmentManager,
  focusManager,
} from '@tanstack/react-query'
import { notificationKeys } from '#/shared/queries/query-keys'
import {
  makeNotification,
  notificationPageFixture,
} from './notification.stories.fixtures'
import type { NotificationFeedCursor } from '#/contexts/feed/application/public-api'
import {
  fetchHeadKeepingHistoryContiguous,
  mergeNotificationHeadWithHistory,
  notificationHeadQueryOptions,
  notificationHistoryQueryOptions,
  NOTIFICATION_POLL_INTERVAL,
  NOTIFICATION_POLL_OPTIONS,
} from './notification-feed-pagination'

let client: QueryClient

beforeEach(() => {
  vi.useFakeTimers()
  // The unit project runs in node, where query-core would classify the runtime
  // as a server and skip every refetch interval outright. The browser is the
  // runtime under test.
  environmentManager.setIsServer(() => false)
  focusManager.setFocused(true)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.mount()
})

afterEach(() => {
  client.unmount()
  client.clear()
  focusManager.setFocused(undefined)
  environmentManager.setIsServer(() => typeof window === 'undefined')
  vi.useRealTimers()
})

function observeUnreadCount(queryFn: () => Promise<number>) {
  const observer = new QueryObserver(client, {
    queryKey: ['notifications', 'count', 'org-1'],
    queryFn,
    ...NOTIFICATION_POLL_OPTIONS,
  })
  return { observer, unsubscribe: observer.subscribe(() => {}) }
}

describe('notification polling posture', () => {
  it('polls on the interval while the tab is visible', async () => {
    const queryFn = vi.fn(async () => 3)
    const { unsubscribe } = observeUnreadCount(queryFn)

    await vi.advanceTimersByTimeAsync(0)
    expect(queryFn).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL)
    expect(queryFn).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL)
    expect(queryFn).toHaveBeenCalledTimes(3)

    unsubscribe()
  })

  it('stops polling while the tab is hidden', async () => {
    const queryFn = vi.fn(async () => 3)
    const { unsubscribe } = observeUnreadCount(queryFn)

    await vi.advanceTimersByTimeAsync(0)
    expect(queryFn).toHaveBeenCalledTimes(1)

    focusManager.setFocused(false)

    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL * 10)
    expect(queryFn).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it('refetches immediately when the tab becomes visible again', async () => {
    const queryFn = vi.fn(async () => 3)
    focusManager.setFocused(false)
    const { unsubscribe } = observeUnreadCount(queryFn)

    await vi.advanceTimersByTimeAsync(0)
    const afterMount = queryFn.mock.calls.length

    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL * 3)
    expect(queryFn).toHaveBeenCalledTimes(afterMount)

    focusManager.setFocused(true)
    // No timer advance beyond the microtask drain: the refetch must be driven
    // by the focus event, not by waiting out another poll interval.
    await vi.advanceTimersByTimeAsync(0)
    expect(queryFn).toHaveBeenCalledTimes(afterMount + 1)

    unsubscribe()
  })

  it('keeps background polling off and the data always stale', () => {
    expect(NOTIFICATION_POLL_OPTIONS.refetchIntervalInBackground).toBe(false)
    expect(NOTIFICATION_POLL_OPTIONS.refetchOnWindowFocus).toBe(true)
    expect(NOTIFICATION_POLL_OPTIONS.staleTime).toBe(0)
  })

  it('polls only the head after older history has been loaded', async () => {
    const feed = createLiveFeed(60)
    const view = observeLiveFeed(feed)

    await vi.advanceTimersByTimeAsync(0)
    expect(feed.requests).toEqual(['head'])

    await view.loadMore()
    await view.loadMore()
    expect(feed.requests).toEqual(['head', 'after R19', 'after R39'])

    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL * 2)
    expect(feed.requests).toEqual(['head', 'after R19', 'after R39', 'head', 'head'])

    view.stop()
  })

  it('publishes page, unread count, and watermark through one observer result', async () => {
    const row = makeNotification({
      id: '10000000-0000-4000-8000-000000000099',
      status: 'unread',
    })
    const fetchHead = vi.fn(async () => ({
      page: notificationPageFixture([row]),
      unreadCount: 7,
      watermark: '2026-08-27T12:00:00.000Z',
    }))
    const observer = new QueryObserver(
      client,
      notificationHeadQueryOptions(
        notificationKeys.head('org-1', 20, 'all'),
        fetchHead,
        false,
      ),
    )
    const unsubscribe = observer.subscribe(() => {})

    await vi.advanceTimersByTimeAsync(0)

    expect(fetchHead).toHaveBeenCalledTimes(1)
    expect(observer.getCurrentResult().data).toEqual({
      page: notificationPageFixture([row]),
      unreadCount: 7,
      watermark: '2026-08-27T12:00:00.000Z',
    })
    unsubscribe()
  })
})

describe('notification head/history merge', () => {
  it('keeps every loaded history row exactly once when the head changes', () => {
    const refreshed = makeNotification({
      id: '10000000-0000-4000-8000-000000000010',
      coalescedCount: 2,
    })
    const overlapFromHistory = makeNotification({
      id: '10000000-0000-4000-8000-000000000010',
      coalescedCount: 1,
    })
    const firstOlder = makeNotification({
      id: '10000000-0000-4000-8000-000000000011',
    })
    const secondOlder = makeNotification({
      id: '10000000-0000-4000-8000-000000000012',
    })

    const merged = mergeNotificationHeadWithHistory(
      notificationPageFixture([refreshed]),
      [
        notificationPageFixture([overlapFromHistory, firstOlder], true),
        notificationPageFixture([secondOlder]),
      ],
    )

    expect(merged.map((row) => row.id)).toEqual([
      refreshed.id,
      firstOlder.id,
      secondOlder.id,
    ])
    expect(merged[0]?.coalescedCount).toBe(2)
  })
})

// ── History paging on a live feed ───────────────────────────────────
//
// The bell and /notifications keep loaded history in memory for the whole
// session while the head keeps polling. Rows then arrive, get dismissed, or
// re-sort under the user. Whatever happens, the visible list must be exactly
// the server's current feed from the top down: no row missing between the
// head and the pages below it, no row skipped by the next "Load more".

const FEED_LIMIT = 20
const FEED_START = Date.parse('2026-09-01T12:00:00.000Z')

const feedRowId = (series: 1 | 2, n: number) =>
  `${series}0000000-0000-4000-8000-${n.toString().padStart(12, '0')}`

/** An in-memory feed, newest first, that the scenario can change between requests. */
function createLiveFeed(size: number) {
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

  const label = (id: string) => labels.get(id) ?? id
  const pageOf = (candidates: typeof rows) =>
    notificationPageFixture(
      candidates.slice(0, FEED_LIMIT),
      candidates.length > FEED_LIMIT,
    )
  // Served like the endpoint: rows strictly after the cursor in feed order.
  const after = (cursor: NotificationFeedCursor) => {
    const at = Date.parse(cursor.at.replace(/(\.\d{3})\d{3}Z$/, '$1Z'))
    return rows.filter(
      (current) =>
        current.createdAt.getTime() < at ||
        (current.createdAt.getTime() === at && current.id < cursor.id),
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
    head: async () => {
      requests.push('head')
      return { page: pageOf(rows), unreadCount: rows.length, watermark: 'live-feed' }
    },
    pageAfter: async (before: NotificationFeedCursor | null) => {
      requests.push(before ? `after ${label(before.id)}` : 'top')
      return pageOf(before ? after(before) : rows)
    },
  }
}

/** The observers useNotifications builds, without React. */
function observeLiveFeed(feed: ReturnType<typeof createLiveFeed>) {
  const historyKey = notificationKeys.list('org-1', FEED_LIMIT, 'all')
  const headObserver = new QueryObserver(
    client,
    notificationHeadQueryOptions(
      notificationKeys.head('org-1', FEED_LIMIT, 'all'),
      fetchHeadKeepingHistoryContiguous(client, historyKey, feed.head),
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
    historyPageCount: () => historyObserver.getCurrentResult().data?.pages.length ?? 0,
    stop: () => {
      unsubscribeHead()
      unsubscribeHistory()
    },
  }
}

describe('notification history paging on a live feed', () => {
  it('keeps every row visible when notifications arrive after history is loaded', async () => {
    const feed = createLiveFeed(60)
    const view = observeLiveFeed(feed)
    await vi.advanceTimersByTimeAsync(0)
    await view.loadMore()

    feed.arrive(5)
    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL)
    expect(view.visible()).toEqual(feed.labels().slice(0, view.visible().length))

    await view.loadMore()
    expect(view.visible()).toEqual(feed.labels().slice(0, view.visible().length))
    view.stop()
  })

  it('does not skip a row when one is dismissed after history is loaded', async () => {
    const feed = createLiveFeed(60)
    const view = observeLiveFeed(feed)
    await vi.advanceTimersByTimeAsync(0)
    await view.loadMore()

    feed.remove('R5')
    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL)
    await view.loadMore()

    expect(view.visible()).toEqual(feed.labels().slice(0, 59))
    view.stop()
  })

  it('keeps loaded history when the refreshed head only shrinks', async () => {
    const feed = createLiveFeed(60)
    const view = observeLiveFeed(feed)
    await vi.advanceTimersByTimeAsync(0)
    await view.loadMore()

    feed.remove('R5')
    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL)

    expect(view.historyPageCount()).toBe(1)
    expect(view.visible()).toEqual(feed.labels().slice(0, 39))
    view.stop()
  })
})
