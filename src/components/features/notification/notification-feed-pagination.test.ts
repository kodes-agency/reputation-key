// Loaded notification history, observed through the REAL QueryObservers the
// hooks build, against an in-memory feed that changes between requests.
//
// The bell and /notifications keep history in memory for the whole session
// while only the head polls. These tests pin what that must never cost: a row
// missing between the head and the pages below it, a row skipped by the next
// "Load more", or rows the server has since changed staying on screen.
//
// No React here: the unit project is node-only, so the observers are driven
// directly, exactly as useNotifications configures them.

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
import { patchNotificationFeedCache } from './notification-feed-cache'
import {
  fetchHeadKeepingHistoryContiguous,
  mergeNotificationHeadWithHistory,
  notificationHeadQueryOptions,
  notificationHistoryQueryOptions,
  NOTIFICATION_POLL_INTERVAL,
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
// Rows arrive, get dismissed, or re-sort under the user. Whatever happens, the
// visible list must be exactly the server's current feed from the top down.

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
  // While held, a head request is answered with the feed as it was when the
  // request was made, and only once released: a read in flight.
  let heldHeads: Array<() => void> | null = null

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
    // What another tab, or the other surface in this one, does to the feed.
    markAllRead: () => {
      rows = rows.map((current) => ({ ...current, status: 'read' as const }))
    },
    dismissAll: () => {
      rows = []
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
      return pageOf(before ? after(before) : rows)
    },
  }
}

/** The observers useNotifications builds, without React. */
function observeLiveFeed(feed: ReturnType<typeof createLiveFeed>) {
  const historyKey = notificationKeys.list('org-1', FEED_LIMIT, 'all')
  const headKey = notificationKeys.head('org-1', FEED_LIMIT, 'all')
  const headObserver = new QueryObserver(
    client,
    notificationHeadQueryOptions(
      headKey,
      fetchHeadKeepingHistoryContiguous(client, headKey, historyKey, feed.head),
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
    stop: () => {
      unsubscribeHead()
      unsubscribeHistory()
    },
  }
}

describe('notification history paging on a live feed', () => {
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

  it('lets a head read cancelled by an optimistic write leave loaded history alone', async () => {
    const feed = createLiveFeed(60)
    const view = observeLiveFeed(feed)
    await vi.advanceTimersByTimeAsync(0)
    await view.loadMore()

    // The next head no longer reaches loaded history, so its answer would
    // reset it; but a mark-read lands while that read is in flight.
    feed.arrive(5)
    feed.holdHeads()
    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL)
    patchNotificationFeedCache(client, 'org-1', (row) =>
      feed.label(row.id) === 'R0' ? { ...row, status: 'read' as const } : row,
    )
    feed.releaseHeads()
    await vi.advanceTimersByTimeAsync(0)

    expect(view.historyPageCount()).toBe(1)
    view.stop()
  })

  it('drops loaded history once the badge proves its unread rows were read elsewhere', async () => {
    const feed = createLiveFeed(60)
    const view = observeLiveFeed(feed)
    await vi.advanceTimersByTimeAsync(0)
    await view.loadMore()

    feed.markAllRead()
    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL)

    // The badge now says 0, so no row on screen may still say "unread".
    expect(view.unreadVisible()).toEqual([])
    view.stop()
  })

  it('drops loaded history once the refreshed head is the whole feed', async () => {
    const feed = createLiveFeed(60)
    const view = observeLiveFeed(feed)
    await vi.advanceTimersByTimeAsync(0)
    await view.loadMore()

    feed.dismissAll()
    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL)

    expect(view.visible()).toEqual([])
    view.stop()
  })
})
