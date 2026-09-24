// Failure behaviour of the reply autosave coordinator: what the head says
// after a save is refused, and what it must not say. Split from
// `reply-autosave-coordinator.test.ts` to keep both files inside the 300-line
// limit; the coordinator under test is the same one.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createReplyAutosaveCoordinator,
  type ReplyAutosaveState,
  type ReplyDraftSnapshot,
} from './reply-autosave-coordinator'

const initial: ReplyDraftSnapshot = { text: 'Initial', languageTag: 'en-Latn' }
const changed: ReplyDraftSnapshot = { text: 'Changed', languageTag: 'en-Latn' }

afterEach(() => vi.useRealTimers())

describe('reply autosave coordinator — after a failed save', () => {
  it('emits the error status and its retry copy to a subscriber when a save fails', async () => {
    vi.useFakeTimers()
    const save = vi
      .fn<(snapshot: ReplyDraftSnapshot) => Promise<void>>()
      .mockRejectedValue(new Error('offline'))
    const observed: ReplyAutosaveState[] = []
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save,
      onState: vi.fn(),
    })
    coordinator.subscribe((state) => observed.push(state))

    coordinator.schedule(changed)
    await vi.advanceTimersByTimeAsync(700)

    expect(save).toHaveBeenCalledWith(changed)
    expect(observed.at(-1)).toEqual({
      status: 'error',
      error: 'Draft could not be saved. Retry before submitting.',
    })
  })

  // `schedule` runs on every keystroke AND on every language change. After a
  // failed save it used to repaint the head unconditionally, so picking a
  // language replaced `Draft could not be saved` with a bare `Not saved` and
  // took `Retry save` (gated on `status === 'error'`) with it — while the
  // coordinator still held the unsaved snapshot and Submit still refused.
  it('keeps saying a save failed while the text that failed is still on screen', async () => {
    vi.useFakeTimers()
    const save = vi
      .fn<(snapshot: ReplyDraftSnapshot) => Promise<void>>()
      .mockRejectedValue(new Error('offline'))
    const observed: ReplyAutosaveState[] = []
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save,
      onState: vi.fn(),
    })
    coordinator.subscribe((state) => observed.push(state))

    coordinator.schedule(changed)
    await vi.advanceTimersByTimeAsync(700)
    expect(observed.at(-1)?.status).toBe('error')

    // The same text, re-scheduled by a language change. `eligible: false` is
    // the harsher case — nothing can be saved — but the failure is still the
    // truth about what is on screen.
    coordinator.schedule(changed, false)

    expect(observed.at(-1)).toEqual({
      status: 'error',
      error: 'Draft could not be saved. Retry before submitting.',
    })
  })

  it('drops the failed snapshot once the text has moved on', async () => {
    vi.useFakeTimers()
    const save = vi
      .fn<(snapshot: ReplyDraftSnapshot) => Promise<void>>()
      .mockRejectedValue(new Error('offline'))
    const observed: ReplyAutosaveState[] = []
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save,
      onState: vi.fn(),
    })
    coordinator.subscribe((state) => observed.push(state))

    coordinator.schedule(changed)
    await vi.advanceTimersByTimeAsync(700)
    expect(observed.at(-1)?.status).toBe('error')

    coordinator.schedule({ text: 'Moved on', languageTag: 'en-Latn' }, false)

    expect(observed.at(-1)?.status).toBe('unsaved')
  })

  it('never reports Saved for text it has not confirmed after a failed save', async () => {
    // The manager's own reply P is saved. A template load writes T server-side
    // and the composer's follow-up save of T fails. Undo puts P back in the box.
    // P equals the last confirmed save — but the server may now hold T, so P
    // must be written again, not reported as `Saved` and skipped by Submit.
    vi.useFakeTimers()
    const observed: ReplyAutosaveState[] = []
    const mine: ReplyDraftSnapshot = { text: 'My own reply', languageTag: 'en-Latn' }
    const template: ReplyDraftSnapshot = { text: 'Template text', languageTag: 'en-Latn' }
    const save = vi
      .fn<(snapshot: ReplyDraftSnapshot) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined)
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save,
      onState: (state) => observed.push(state),
    })

    await coordinator.flush(mine)
    await coordinator.flush(template).catch(() => undefined)
    expect(observed.at(-1)?.status).toBe('error')

    coordinator.schedule(mine)
    expect(observed.at(-1)?.status).toBe('pending')

    // Submit's flush must write the box, not trust a stale "Saved".
    await coordinator.flush(mine)
    expect(save).toHaveBeenLastCalledWith(mine)
    expect(save).toHaveBeenCalledTimes(3)
  })
})
