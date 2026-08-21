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
  QueryClient,
  QueryObserver,
  environmentManager,
  focusManager,
} from '@tanstack/react-query'
import {
  NOTIFICATION_POLL_INTERVAL,
  NOTIFICATION_POLL_OPTIONS,
} from './notification-queries'

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
})
