// The older list under the polled head, observed through the REAL query and
// mutation wiring the hooks build, against an in-memory feed that changes
// between requests.
//
// The bell and /notifications keep older rows in memory for the whole session
// while only the head polls. These tests pin what that must never cost: a row
// missing between the head and the rows below it, a row skipped by the next
// "Load more", rows the server has since changed staying on screen, or one
// write's outcome undoing another's.
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
import { NOTIFICATION_POLL_INTERVAL } from './notification-feed-head'
import { mergeNotificationRows } from './notification-feed-older'

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

let stops: Array<() => void> = []

afterEach(() => {
  for (const stop of stops) stop()
  stops = []
  client.unmount()
  client.clear()
  focusManager.setFocused(undefined)
  environmentManager.setIsServer(() => typeof window === 'undefined')
  vi.useRealTimers()
})

describe('notification head and older rows merge', () => {
  it('keeps every loaded older row exactly once when the head changes', () => {
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

    const merged = mergeNotificationRows(notificationPageFixture([refreshed]), [
      overlapFromHistory,
      firstOlder,
      secondOlder,
    ])

    expect(merged.map((row) => row.id)).toEqual([
      refreshed.id,
      firstOlder.id,
      secondOlder.id,
    ])
    expect(merged[0]?.coalescedCount).toBe(2)
  })
})

// ── Older rows on a live feed ────────────────────────────────────────
//
// Rows arrive, get dismissed, or re-sort under the user. Whatever happens, the
// visible list must be exactly the server's current feed from the top down.

const FEED_LIMIT = LIVE_FEED_LIMIT
const observeLiveFeed = (feed: ReturnType<typeof createLiveFeed>) =>
  observeLiveFeedWith(client, feed)
const poll = () => vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL)
const settle = () => vi.advanceTimersByTimeAsync(0)

async function openWithOlderRows(pages: number) {
  const feed = createLiveFeed(60)
  const view = observeLiveFeed(feed)
  stops.push(view.stop)
  await settle()
  for (let page = 0; page < pages; page += 1) await view.loadMore()
  return { feed, view }
}

const rowInput = (feed: ReturnType<typeof createLiveFeed>, label: string) => ({
  data: {
    notificationId: [...feed.labelsById()].find(([, name]) => name === label)![0],
  },
})

describe('older rows on a live feed', () => {
  it('polls only the head after older rows have been loaded', async () => {
    const { feed } = await openWithOlderRows(2)
    expect(feed.requests).toEqual(['head', 'after R19', 'after R39'])

    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL * 2)
    expect(feed.requests).toEqual(['head', 'after R19', 'after R39', 'head', 'head'])
  })

  it('keeps every row visible when notifications arrive after older rows are loaded', async () => {
    const { feed, view } = await openWithOlderRows(1)

    feed.arrive(5)
    await poll()
    expect(view.visible()).toEqual(feed.labels().slice(0, 40))

    await view.loadMore()
    expect(view.visible()).toEqual(feed.labels().slice(0, 60))
  })

  it('keeps the loaded depth on screen when a notification arrives above it', async () => {
    const { feed, view } = await openWithOlderRows(2)

    feed.arrive(1)
    await poll()

    // As many rows as the user had loaded, from the top, with none missing.
    expect(view.visible()).toEqual(feed.labels().slice(0, 60))
    await view.loadMore()
    expect(view.visible()).toEqual(feed.labels())
  })

  it("keeps the older rows when the head's last row re-sorts to the top", async () => {
    const { feed, view } = await openWithOlderRows(1)

    feed.coalesce('R19')
    await poll()

    expect(view.visible()).toEqual(feed.labels().slice(0, 40))
    await view.loadMore()
    expect(view.visible()).toEqual(feed.labels())
  })

  it('keeps the loaded depth when more rows arrive than one page holds', async () => {
    const { feed, view } = await openWithOlderRows(1)

    feed.arrive(FEED_LIMIT + 5)
    await poll()

    expect(view.visible()).toEqual(feed.labels().slice(0, FEED_LIMIT * 2))
    await view.loadMore()
    expect(view.visible()).toEqual(feed.labels().slice(0, FEED_LIMIT * 3))
  })

  it('still shows the refreshed head, and no gap, when re-reading the older rows fails', async () => {
    const { feed, view } = await openWithOlderRows(1)

    feed.arrive(1)
    feed.failPages()
    await poll()

    expect(view.visible()).toEqual(feed.labels().slice(0, FEED_LIMIT))
    expect(view.olderRowCount()).toBe(0)
    expect(view.headError()).toBeNull()
  })

  it('does not skip a row when one is dismissed after older rows are loaded', async () => {
    const { feed, view } = await openWithOlderRows(1)

    feed.remove('R5')
    await poll()
    await view.loadMore()

    expect(view.visible()).toEqual(feed.labels().slice(0, 59))
  })

  it('re-reads nothing when a poll finds the head unchanged', async () => {
    const { feed } = await openWithOlderRows(1)
    await poll()
    expect(feed.requests).toEqual(['head', 'after R19', 'head'])
  })

  it('re-reads the older rows once the badge proves their unread rows were read elsewhere', async () => {
    const { feed, view } = await openWithOlderRows(1)

    feed.markAllRead()
    await poll()

    // The badge now says 0, so no row on screen may still say "unread".
    expect(view.unreadVisible()).toEqual([])
    expect(view.visible()).toEqual(feed.labels().slice(0, 40))
  })

  it('drops the older rows once the refreshed head is the whole feed', async () => {
    const { feed, view } = await openWithOlderRows(1)

    feed.dismissAll()
    await poll()

    expect(view.visible()).toEqual([])
  })

  it('finishes a "Load more" asked for while a head read is re-reading the older rows', async () => {
    const { feed, view } = await openWithOlderRows(1)

    feed.arrive(1)
    feed.holdPages()
    await poll()
    const loading = view.loadMore()
    feed.releasePages()
    await settle()
    feed.releasePages()
    await loading

    // The re-read lands first, then the page asked for continues from it.
    expect(view.visible()).toEqual(feed.labels().slice(0, 60))
  })
})

describe('feed writes over a live feed', () => {
  it('keeps a write on screen while a poll answered from before it lands', async () => {
    const { feed, view } = await openWithOlderRows(1)

    feed.holdHeads()
    await poll()
    const write = view.write('dismiss', rowInput(feed, 'R0'), () => feed.remove('R0'))
    await settle()
    expect(view.visible()).not.toContain('R0')

    feed.releaseHeads()
    await settle()
    expect(view.visible()).not.toContain('R0')

    write.answer(true)
    await write.settled
    expect(view.visible()).toEqual(feed.labels().slice(0, 40))
  })

  it('applies a write to a row loaded below the head, and keeps it there after it settles', async () => {
    const { feed, view } = await openWithOlderRows(1)

    const write = view.write('dismiss', rowInput(feed, 'R25'), () => feed.remove('R25'))
    await settle()
    expect(view.visible()).not.toContain('R25')

    write.answer(true)
    await write.settled
    expect(view.visible()).not.toContain('R25')
    await poll()
    expect(view.visible()).toEqual(feed.labels().slice(0, 39))
  })

  it('does not bring back a row a sibling write removed when another write fails', async () => {
    const { feed, view } = await openWithOlderRows(1)

    const first = view.write('dismiss', rowInput(feed, 'R22'), () => feed.remove('R22'))
    const second = view.write('dismiss', rowInput(feed, 'R25'), () => feed.remove('R25'))
    await settle()
    second.answer(true)
    await second.settled
    first.answer(false)
    await first.settled

    // The failed write's row is back as the server has it; the sibling's is not.
    expect(view.visible()).toContain('R22')
    expect(view.visible()).not.toContain('R25')
    expect(view.visible()).toEqual(feed.labels().slice(0, 40))
  })

  it('moves the badge at once and settles on the count the server reads', async () => {
    const { feed, view } = await openWithOlderRows(1)
    expect(view.unreadCount()).toBe(60)

    const write = view.write('markRead', rowInput(feed, 'R25'), () =>
      feed.markRead('R25'),
    )
    await settle()
    expect(view.unreadCount()).toBe(59)
    expect(view.unreadVisible()).not.toContain('R25')

    write.answer(true)
    await write.settled
    expect(view.unreadCount()).toBe(59)
    expect(view.unreadVisible()).not.toContain('R25')
  })

  it('brings an older row back at its place when its dismissal is undone', async () => {
    const { feed, view } = await openWithOlderRows(1)

    const dismissal = view.write('dismiss', rowInput(feed, 'R25'), () =>
      feed.remove('R25'),
    )
    await settle()
    dismissal.answer(true)
    await dismissal.settled
    expect(view.visible()).not.toContain('R25')

    const input = { data: { notificationId: feed.removedId('R25') } }
    const undo = view.write('restore', input, () => feed.restore('R25'))
    await settle()
    undo.answer(true)
    await undo.settled

    expect(view.visible()).toEqual(feed.labels().slice(0, 40))
    expect(view.visible()).toContain('R25')
  })
})
