// The bar waits before it shows, so a fast page change never flashes it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ROUTE_PROGRESS_DELAY_MS, showAfterDelay } from './route-progress'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('showAfterDelay', () => {
  it('does not show the bar before the delay has passed', () => {
    const show = vi.fn()
    showAfterDelay(show, ROUTE_PROGRESS_DELAY_MS)

    vi.advanceTimersByTime(ROUTE_PROGRESS_DELAY_MS - 1)

    expect(show).not.toHaveBeenCalled()
  })

  it('shows the bar once, when the delay has passed', () => {
    const show = vi.fn()
    showAfterDelay(show, ROUTE_PROGRESS_DELAY_MS)

    vi.advanceTimersByTime(ROUTE_PROGRESS_DELAY_MS)
    vi.advanceTimersByTime(ROUTE_PROGRESS_DELAY_MS * 5)

    expect(show).toHaveBeenCalledTimes(1)
  })

  it('never shows the bar for a navigation that finishes inside the delay', () => {
    const show = vi.fn()
    const cancel = showAfterDelay(show, ROUTE_PROGRESS_DELAY_MS)

    vi.advanceTimersByTime(ROUTE_PROGRESS_DELAY_MS - 50)
    cancel()
    vi.advanceTimersByTime(ROUTE_PROGRESS_DELAY_MS * 5)

    expect(show).not.toHaveBeenCalled()
  })

  it('waits 150 ms, as the plan for the shell says', () => {
    expect(ROUTE_PROGRESS_DELAY_MS).toBe(150)
  })
})
