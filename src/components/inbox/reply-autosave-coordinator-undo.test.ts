import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createReplyAutosaveCoordinator,
  type ReplyDraftSnapshot,
} from './reply-autosave-coordinator'

const initial: ReplyDraftSnapshot = { text: 'Initial', languageTag: 'en-Latn' }
const changed: ReplyDraftSnapshot = { text: 'Changed', languageTag: 'en-Latn' }

afterEach(() => vi.useRealTimers())

describe('reply autosave coordinator — undo during a save', () => {
  it.each(['submit', 'debounce', 'teardown'] as const)(
    'keeps the undone text on the server through %s',
    async (nextAction) => {
      vi.useFakeTimers()
      let release!: () => void
      const inFlight = new Promise<void>((resolve) => {
        release = resolve
      })
      let stored = initial
      const save = vi.fn(async (snapshot: ReplyDraftSnapshot) => {
        if (snapshot === changed) await inFlight
        stored = snapshot
      })
      const coordinator = createReplyAutosaveCoordinator({
        initial,
        save,
        onState: vi.fn(),
      })

      coordinator.schedule(changed)
      await vi.advanceTimersByTimeAsync(700)
      expect(save).toHaveBeenCalledWith(changed)

      coordinator.schedule(initial)
      let submitting: Promise<void> | undefined
      if (nextAction === 'submit') submitting = coordinator.flush(initial)
      else if (nextAction === 'debounce') await vi.advanceTimersByTimeAsync(700)
      else {
        coordinator.flushOnTeardown()
        coordinator.dispose()
      }

      release()
      await submitting
      await vi.advanceTimersByTimeAsync(0)

      expect(stored).toEqual(initial)
      expect(save).toHaveBeenCalledTimes(2)
      expect(save).toHaveBeenLastCalledWith(initial)
    },
  )
})
