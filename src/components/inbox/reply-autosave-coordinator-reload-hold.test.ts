// A tab whose code is older than the server reloads itself (shared/stale-tab),
// and it defers the reload while a mutation is in flight. A reload never
// unmounts the composer, so words still inside the 700 ms debounce, or on
// their way to the server, would be lost with the page. The coordinator holds
// the reload for exactly as long as typed words are not saved.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createReplyAutosaveCoordinator,
  isReloadSafe,
  type ReplyAutosaveStatus,
  type ReplyDraftSnapshot,
} from './reply-autosave-coordinator'

const hoisted = vi.hoisted(() => ({ held: 0 }))

vi.mock('#/shared/stale-tab/stale-tab', () => ({
  staleTab: {
    trackMutation<T>(call: Promise<T>): Promise<T> {
      hoisted.held += 1
      const settled = (): void => void (hoisted.held -= 1)
      call.then(settled, settled)
      return call
    },
  },
}))

const initial: ReplyDraftSnapshot = { text: 'Initial', languageTag: 'en-Latn' }
const typed: ReplyDraftSnapshot = {
  text: 'Thanks for staying with us',
  languageTag: 'en-Latn',
}

function deferredSave() {
  let finish = (): void => undefined
  const save = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  return { save, finish: () => finish() }
}

beforeEach(() => {
  hoisted.held = 0
  vi.useFakeTimers()
})

afterEach(() => vi.useRealTimers())

describe('whether a reload could lose the words', () => {
  it.each<ReplyAutosaveStatus>(['idle', 'pending', 'saving', 'saved'])(
    'it cannot while the status is %s: they are saved, or the reload is held until they are',
    (status) => {
      expect(isReloadSafe(status)).toBe(true)
    },
  )

  it.each<ReplyAutosaveStatus>(['unsaved', 'error'])(
    'it could while the status is %s: nothing holds the reload, and the words are on this page alone',
    (status) => {
      expect(isReloadSafe(status)).toBe(false)
    },
  )
})

describe('reply autosave holds a stale tab reload', () => {
  it('while typed words wait for the debounce and until their save lands', async () => {
    const { save, finish } = deferredSave()
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save,
      onState: vi.fn(),
    })

    coordinator.schedule(typed)
    await vi.advanceTimersByTimeAsync(0)
    expect(hoisted.held).toBeGreaterThan(0)

    await vi.advanceTimersByTimeAsync(700)
    expect(save).toHaveBeenCalledWith(typed)
    expect(hoisted.held).toBeGreaterThan(0)

    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(hoisted.held).toBe(0)
  })

  it('while a flush is saving', async () => {
    const { save, finish } = deferredSave()
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save,
      onState: vi.fn(),
    })

    coordinator.schedule(typed)
    const flushed = coordinator.flush(typed)
    await vi.advanceTimersByTimeAsync(0)
    expect(hoisted.held).toBeGreaterThan(0)

    finish()
    await flushed
    await vi.advanceTimersByTimeAsync(0)
    expect(hoisted.held).toBe(0)
  })

  it('while the teardown save of words still in the debounce is on its way', async () => {
    const { save, finish } = deferredSave()
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save,
      onState: vi.fn(),
    })

    coordinator.schedule(typed)
    coordinator.flushOnTeardown()
    coordinator.dispose()
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledWith(typed)
    expect(hoisted.held).toBeGreaterThan(0)

    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(hoisted.held).toBe(0)
  })

  it('not when there is nothing to save, and not after the words are discarded', async () => {
    const save = vi.fn(async () => undefined)
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save,
      onState: vi.fn(),
    })

    coordinator.schedule(initial)
    coordinator.schedule(typed, false)
    await vi.advanceTimersByTimeAsync(0)
    expect(hoisted.held).toBe(0)

    coordinator.schedule(typed)
    coordinator.dispose()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(save).not.toHaveBeenCalled()
    expect(hoisted.held).toBe(0)
  })

  it('lets go when a save fails', async () => {
    const save = vi.fn(async () => {
      throw new Error('offline')
    })
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save,
      onState: vi.fn(),
    })

    coordinator.schedule(typed)
    await vi.advanceTimersByTimeAsync(700)
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalled()
    expect(hoisted.held).toBe(0)
  })
})
