import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startSingleFlight } from './single-flight'

describe('startSingleFlight', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs at once only when asked, then every interval', async () => {
    const tick = vi.fn(async () => undefined)
    const stop = startSingleFlight({
      tick,
      intervalMs: 100,
      immediate: false,
      onError: vi.fn(),
    })
    expect(tick).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(tick).toHaveBeenCalledTimes(1)
    await stop()

    const immediate = vi.fn(async () => undefined)
    const stopImmediate = startSingleFlight({
      tick: immediate,
      intervalMs: 100,
      immediate: true,
      onError: vi.fn(),
    })
    expect(immediate).toHaveBeenCalledTimes(1)
    await stopImmediate()
  })

  it('skips a tick while the previous run is still going', async () => {
    let release: () => void = () => undefined
    const tick = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const stop = startSingleFlight({
      tick,
      intervalMs: 100,
      immediate: false,
      onError: vi.fn(),
    })
    await vi.advanceTimersByTimeAsync(300)
    expect(tick).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(100)
    expect(tick).toHaveBeenCalledTimes(2)
    release()
    await stop()
  })

  it('reports a failed run and keeps running', async () => {
    const onError = vi.fn()
    const boom = new Error('boom')
    const tick = vi.fn(async () => {
      throw boom
    })
    const stop = startSingleFlight({ tick, intervalMs: 100, immediate: false, onError })
    await vi.advanceTimersByTimeAsync(200)
    expect(onError).toHaveBeenCalledWith(boom)
    expect(tick).toHaveBeenCalledTimes(2)
    await stop()
  })

  it('stop flags the tick, ends the timer and waits for the run in flight', async () => {
    let release: () => void = () => undefined
    let seenStopped: (() => boolean) | undefined
    const tick = vi.fn((isStopped: () => boolean) => {
      seenStopped = isStopped
      return new Promise<void>((resolve) => {
        release = resolve
      })
    })
    const stop = startSingleFlight({
      tick,
      intervalMs: 100,
      immediate: true,
      onError: vi.fn(),
    })
    expect(seenStopped?.()).toBe(false)
    let stopped = false
    const stopping = stop().then(() => {
      stopped = true
    })
    expect(seenStopped?.()).toBe(true)
    await Promise.resolve()
    expect(stopped).toBe(false)
    release()
    await stopping
    expect(stopped).toBe(true)
    await vi.advanceTimersByTimeAsync(500)
    expect(tick).toHaveBeenCalledTimes(1)
  })
})
