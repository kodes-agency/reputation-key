// The check on return from "Open on Google" (spec: a manager who replied on
// Google and comes back should not wait up to ~6 h for the next sync).
//
// The watcher is plain TypeScript over an injected clock, timer and page
// visibility, so the rules are driven here with a fake page: the tab goes
// hidden, comes back, and time passes, with nothing real running.

import { describe, expect, it, vi } from 'vitest'
import {
  RETURN_CHECK_WINDOW_MS,
  RETURN_FOLLOW_UP_DELAYS_MS,
  createReturnWatcher,
} from './google-return-watcher'
import { fakePage } from './google-return-fake-page'

const MINUTE = 60_000

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function setup(results: ReadonlyArray<boolean> = []) {
  const page = fakePage()
  const calls: string[] = []
  let call = 0
  const check = vi.fn(async (reviewId: string) => {
    calls.push(reviewId)
    return results[call++] ?? false
  })
  const watcher = createReturnWatcher({ env: page.env, check })
  return { page, watcher, check, calls }
}

describe('the return from Google', () => {
  it('checks the moment the tab is visible again, within 30 minutes of the click', async () => {
    const { page, watcher, check } = setup()
    watcher.focus('rev-1')
    watcher.opened('rev-1')
    page.hide()
    page.advance(5 * MINUTE)
    expect(check).not.toHaveBeenCalled()

    page.show()
    await settle()

    expect(check).toHaveBeenCalledTimes(1)
    expect(check).toHaveBeenCalledWith('rev-1')
  })

  it('does not check on a return after the 30-minute window', async () => {
    const { page, watcher, check } = setup()
    watcher.focus('rev-1')
    watcher.opened('rev-1')
    page.hide()
    page.advance(RETURN_CHECK_WINDOW_MS + 1)
    page.show()
    await settle()
    expect(check).not.toHaveBeenCalled()
  })

  it('does check on a return at the very edge of the window', async () => {
    const { page, watcher, check } = setup()
    watcher.focus('rev-1')
    watcher.opened('rev-1')
    page.hide()
    page.advance(RETURN_CHECK_WINDOW_MS)
    page.show()
    await settle()
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the manager never opened Google', async () => {
    const { page, watcher, check } = setup()
    watcher.focus('rev-1')
    page.hide()
    page.show()
    await settle()
    expect(check).not.toHaveBeenCalled()
  })

  it('does not check another review than the one that was opened on Google', async () => {
    const { page, watcher, check } = setup()
    watcher.focus('rev-2')
    watcher.opened('rev-1')
    page.hide()
    page.show()
    await settle()
    expect(check).not.toHaveBeenCalled()
  })

  it('forgets the click when the manager moves to another item, even if they come back', async () => {
    const { page, watcher, check } = setup()
    watcher.focus('rev-1')
    watcher.opened('rev-1')
    watcher.focus('rev-2')
    watcher.focus('rev-1')
    page.hide()
    page.show()
    await settle()
    expect(check).not.toHaveBeenCalled()
  })

  it('forgets the click when the item closes or the pane is left (no item in focus)', async () => {
    const { page, watcher, check } = setup()
    watcher.focus('rev-1')
    watcher.opened('rev-1')
    watcher.focus(null)
    watcher.focus('rev-1')
    page.hide()
    page.show()
    await settle()
    expect(check).not.toHaveBeenCalled()
  })
})

describe('the follow-up checks', () => {
  it('checks again 2 and 10 minutes after a return that found no reply', async () => {
    expect(RETURN_FOLLOW_UP_DELAYS_MS).toEqual([2 * MINUTE, 10 * MINUTE])
    const { page, watcher, check } = setup()
    watcher.focus('rev-1')
    watcher.opened('rev-1')
    page.hide()
    page.show()
    await settle()
    expect(check).toHaveBeenCalledTimes(1)

    page.advance(2 * MINUTE - 1)
    expect(check).toHaveBeenCalledTimes(1)
    page.advance(1)
    await settle()
    expect(check).toHaveBeenCalledTimes(2)

    page.advance(8 * MINUTE)
    await settle()
    expect(check).toHaveBeenCalledTimes(3)

    page.advance(60 * MINUTE)
    await settle()
    expect(check).toHaveBeenCalledTimes(3)
    expect(page.pendingTimers()).toBe(0)
  })

  it('stops as soon as a check finds the reply: no more checks, no more timers', async () => {
    const { page, watcher, check } = setup([true])
    watcher.focus('rev-1')
    watcher.opened('rev-1')
    page.hide()
    page.show()
    await settle()
    expect(check).toHaveBeenCalledTimes(1)
    expect(page.pendingTimers()).toBe(0)

    page.advance(20 * MINUTE)
    await settle()
    expect(check).toHaveBeenCalledTimes(1)
    // Nor does a later return count: the click was spent on the reply.
    page.hide()
    page.show()
    await settle()
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('stops when a follow-up finds the reply', async () => {
    const { page, watcher, check } = setup([false, true])
    watcher.focus('rev-1')
    watcher.opened('rev-1')
    page.hide()
    page.show()
    await settle()
    page.advance(2 * MINUTE)
    await settle()
    expect(check).toHaveBeenCalledTimes(2)
    expect(page.pendingTimers()).toBe(0)
    page.advance(20 * MINUTE)
    await settle()
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('stops when the item closes before the next check', async () => {
    const { page, watcher, check } = setup()
    watcher.focus('rev-1')
    watcher.opened('rev-1')
    page.hide()
    page.show()
    await settle()

    watcher.focus(null)
    expect(page.pendingTimers()).toBe(0)
    page.advance(20 * MINUTE)
    await settle()
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('stops when the manager opens another item', async () => {
    const { page, watcher, check } = setup()
    watcher.focus('rev-1')
    watcher.opened('rev-1')
    page.hide()
    page.show()
    await settle()

    watcher.focus('rev-2')
    page.advance(20 * MINUTE)
    await settle()
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('stops, and releases the page, on dispose (unmount)', async () => {
    const { page, watcher, check } = setup()
    watcher.focus('rev-1')
    watcher.opened('rev-1')
    page.hide()
    page.show()
    await settle()

    watcher.dispose()
    expect(page.pendingTimers()).toBe(0)
    expect(page.listenerCount()).toBe(0)
    page.advance(20 * MINUTE)
    await settle()
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('runs no follow-up while the tab is hidden', async () => {
    const { page, watcher, check } = setup()
    watcher.focus('rev-1')
    watcher.opened('rev-1')
    page.hide()
    page.show()
    await settle()

    page.hide()
    page.advance(2 * MINUTE)
    await settle()
    expect(check).toHaveBeenCalledTimes(1)

    // The next one is on schedule, and it too waits for the page to be visible.
    page.show()
    await settle()
    // Coming back is itself a return inside the window: it checks at once.
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('starts the follow-ups over on a second return, so they never pile up', async () => {
    const { page, watcher, check } = setup()
    watcher.focus('rev-1')
    watcher.opened('rev-1')
    page.hide()
    page.show()
    await settle()
    page.advance(1 * MINUTE)
    page.hide()
    page.show()
    await settle()
    expect(check).toHaveBeenCalledTimes(2)
    expect(page.pendingTimers()).toBe(RETURN_FOLLOW_UP_DELAYS_MS.length)
  })

  it('opening Google again clears the earlier follow-ups', async () => {
    const { page, watcher } = setup()
    watcher.focus('rev-1')
    watcher.opened('rev-1')
    page.hide()
    page.show()
    await settle()
    expect(page.pendingTimers()).toBe(RETURN_FOLLOW_UP_DELAYS_MS.length)

    watcher.opened('rev-1')
    expect(page.pendingTimers()).toBe(0)
  })

  it('survives a check that throws, and keeps its schedule', async () => {
    const page = fakePage()
    const check = vi
      .fn<(reviewId: string) => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(false)
    const watcher = createReturnWatcher({ env: page.env, check })
    watcher.focus('rev-1')
    watcher.opened('rev-1')
    page.hide()
    page.show()
    await settle()
    page.advance(2 * MINUTE)
    await settle()
    expect(check).toHaveBeenCalledTimes(2)
  })
})
