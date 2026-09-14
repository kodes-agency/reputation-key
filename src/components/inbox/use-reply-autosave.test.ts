import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createReplyAutosaveCoordinator,
  type ReplyAutosaveState,
  type ReplyDraftSnapshot,
} from './reply-autosave-coordinator'
import { attachReplyAutosave } from './use-reply-autosave'

const initial: ReplyDraftSnapshot = { text: 'Initial', languageTag: 'en-Latn' }
const changed: ReplyDraftSnapshot = { text: 'Changed', languageTag: 'en-Latn' }
const IDLE: ReplyAutosaveState = { status: 'idle', error: null }
const SAVE_FAILED = 'Draft could not be saved. Retry before submitting.'

/** Stands in for the hook's `useState` pair; the unit project has no renderer. */
function statusSlot() {
  const slot = { state: IDLE }
  return {
    slot,
    setState: (next: ReplyAutosaveState) => {
      slot.state = next
    },
  }
}

afterEach(() => vi.useRealTimers())

describe('reply autosave mount lifecycle', () => {
  // The regression: StrictMode runs mount → teardown → mount against the
  // coordinator `useState` keeps, so a teardown that cannot be undone silences
  // the status before the first keystroke — `Draft not saved` and `Retry save`
  // unreachable in development and in every storybook test.
  it('still reports a failed save after StrictMode mounts, tears down and mounts again', async () => {
    vi.useFakeTimers()
    const { slot, setState } = statusSlot()
    const save = vi
      .fn<(snapshot: ReplyDraftSnapshot) => Promise<void>>()
      .mockRejectedValue(new Error('offline'))
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save,
      onState: setState,
    })

    const teardown = attachReplyAutosave(coordinator, setState)
    teardown()
    attachReplyAutosave(coordinator, setState)

    coordinator.schedule(changed)
    await vi.advanceTimersByTimeAsync(700)

    expect(save).toHaveBeenCalledWith(changed)
    expect(slot.state).toEqual({ status: 'error', error: SAVE_FAILED })
  })

  it('reports a successful save after the same double mount', async () => {
    vi.useFakeTimers()
    const { slot, setState } = statusSlot()
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save: vi.fn(async () => undefined),
      onState: setState,
    })

    attachReplyAutosave(coordinator, setState)()
    attachReplyAutosave(coordinator, setState)

    coordinator.schedule(changed)
    expect(slot.state).toEqual({ status: 'pending', error: null })
    await vi.advanceTimersByTimeAsync(700)

    expect(slot.state).toEqual({ status: 'saved', error: null })
  })

  it('drops status once the mount really ends', () => {
    const { slot, setState } = statusSlot()
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save: vi.fn(async () => undefined),
      onState: setState,
    })

    attachReplyAutosave(coordinator, setState)()
    coordinator.schedule(changed, false)

    expect(slot.state).toEqual(IDLE)
  })

  it('cancels a debounced save that has not fired when the mount ends', async () => {
    vi.useFakeTimers()
    const { setState } = statusSlot()
    const save = vi.fn(async () => undefined)
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save,
      onState: setState,
    })

    const teardown = attachReplyAutosave(coordinator, setState)
    coordinator.schedule(changed)
    teardown()
    await vi.advanceTimersByTimeAsync(700)

    expect(save).not.toHaveBeenCalled()
  })
})
