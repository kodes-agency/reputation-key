// Loaded notification history, observed through the REAL QueryObservers the
// hooks build, against an in-memory feed that changes between requests.
//
// The bell and /notifications keep history in memory for the whole session
// while only the head polls. These tests pin what that must never cost: a row
// missing between the head and the pages below it, a row skipped by the next
// "Load more", or rows the server has since changed staying on screen.
//
// The feed and its observers are notification.stories.live-feed.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, environmentManager, focusManager } from '@tanstack/react-query'
import {
  makeNotification,
  notificationPageFixture,
} from './notification.stories.fixtures'
import {
  createLiveFeed,
  LIVE_FEED_LIMIT,
  observeLiveFeed as observeLiveFeedWith,
} from './notification.stories.live-feed'
import { patchNotificationFeedCache } from './notification-feed-cache'
import {
  mergeNotificationHeadWithHistory,
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

const FEED_LIMIT = LIVE_FEED_LIMIT
const observeLiveFeed = (feed: ReturnType<typeof createLiveFeed>) =>
  observeLiveFeedWith(client, feed)

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
    expect(view.visible()).toEqual(feed.labels().slice(0, 45))

    await view.loadMore()
    expect(view.visible()).toEqual(feed.labels())
    view.stop()
  })

  it('keeps loaded history on screen when a notification arrives above it', async () => {
    const feed = createLiveFeed(60)
    const view = observeLiveFeed(feed)
    await vi.advanceTimersByTimeAsync(0)
    await view.loadMore()
    await view.loadMore()

    feed.arrive(1)
    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL)

    // Every row the user had loaded is still listed, under the new one.
    expect(view.visible()).toEqual(feed.labels().slice(0, 61))
    await view.loadMore()
    expect(view.visible()).toEqual(feed.labels())
    view.stop()
  })

  it("keeps loaded history when the head's last row re-sorts to the top", async () => {
    const feed = createLiveFeed(60)
    const view = observeLiveFeed(feed)
    await vi.advanceTimersByTimeAsync(0)
    await view.loadMore()

    feed.coalesce('R19')
    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL)

    expect(view.visible()).toEqual(feed.labels().slice(0, 40))
    await view.loadMore()
    expect(view.visible()).toEqual(feed.labels())
    view.stop()
  })

  it('still shows the refreshed head when reading the rows above history fails', async () => {
    const feed = createLiveFeed(60)
    const view = observeLiveFeed(feed)
    await vi.advanceTimersByTimeAsync(0)
    await view.loadMore()

    feed.arrive(1)
    feed.failPages()
    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL)

    // No silent gap either: without the rows between, history goes.
    expect(view.visible()).toEqual(feed.labels().slice(0, FEED_LIMIT))
    expect(view.headError()).toBeNull()
    view.stop()
  })

  it('falls back to the head alone when more rows arrive than one page can bridge', async () => {
    const feed = createLiveFeed(60)
    const view = observeLiveFeed(feed)
    await vi.advanceTimersByTimeAsync(0)
    await view.loadMore()

    feed.arrive(FEED_LIMIT + 5)
    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL)

    expect(view.historyPageCount()).toBe(0)
    expect(view.visible()).toEqual(feed.labels().slice(0, FEED_LIMIT))
    await view.loadMore()
    expect(view.visible()).toEqual(feed.labels().slice(0, FEED_LIMIT * 2))
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
