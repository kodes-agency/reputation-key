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
import { makeNotification, notificationPageFixture } from './notification-fixtures'
import {
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
    const offsets: number[] = []
    const fetchPage = vi.fn(async (offset: number) => {
      offsets.push(offset)
      return notificationPageFixture([], offset < 40)
    })
    const headObserver = new QueryObserver(
      client,
      notificationHeadQueryOptions(
        notificationKeys.head('org-1', 20, 'all'),
        fetchPage,
        true,
      ),
    )
    const historyObserver = new InfiniteQueryObserver(
      client,
      notificationHistoryQueryOptions(
        notificationKeys.list('org-1', 20, 'all'),
        fetchPage,
        20,
      ),
    )
    const unsubscribeHead = headObserver.subscribe(() => {})
    const unsubscribeHistory = historyObserver.subscribe(() => {})

    await vi.advanceTimersByTimeAsync(0)
    expect(offsets).toEqual([0])

    await historyObserver.fetchNextPage()
    expect(offsets).toEqual([0, 20])
    await historyObserver.fetchNextPage()
    expect(offsets).toEqual([0, 20, 40])

    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL * 2)
    expect(offsets).toEqual([0, 20, 40, 0, 0])

    unsubscribeHead()
    unsubscribeHistory()
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
