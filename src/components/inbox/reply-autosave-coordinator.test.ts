import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createReplyAutosaveCoordinator,
  type ReplyAutosaveState,
  type ReplyDraftSnapshot,
} from './reply-autosave-coordinator'

const initial: ReplyDraftSnapshot = { text: 'Initial', languageTag: 'en-Latn' }
const changed: ReplyDraftSnapshot = { text: 'Changed', languageTag: 'en-Latn' }

afterEach(() => vi.useRealTimers())

describe('reply autosave coordinator', () => {
  it('debounces rapid edits and saves only the latest snapshot', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => undefined)
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save,
      onState: vi.fn(),
    })

    coordinator.schedule({ ...changed, text: 'First' })
    await vi.advanceTimersByTimeAsync(400)
    coordinator.schedule(changed)
    await vi.advanceTimersByTimeAsync(699)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(changed)
  })

  it('flushes the current snapshot before submit can continue', async () => {
    vi.useFakeTimers()
    const order: string[] = []
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save: async () => {
        order.push('save')
      },
      onState: vi.fn(),
    })
    coordinator.schedule(changed)

    await coordinator.flush(changed)
    order.push('submit')

    expect(order).toEqual(['save', 'submit'])
  })

  it('retains a failed draft and retries it explicitly', async () => {
    vi.useFakeTimers()
    const save = vi
      .fn<(snapshot: ReplyDraftSnapshot) => Promise<void>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined)
    const states: string[] = []
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save,
      onState: ({ status }) => states.push(status),
    })
    coordinator.schedule(changed)
    await vi.advanceTimersByTimeAsync(700)

    expect(states.at(-1)).toBe('error')
    await coordinator.retry()

    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith(changed)
    expect(states.at(-1)).toBe('saved')
  })

  it('saves accepted AI text with its provenance token and never submits it', async () => {
    const save = vi.fn(async () => undefined)
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save,
      onState: vi.fn(),
    })
    const aiDraft = { text: 'AI draft', languageTag: 'tr-Latn-TR' }

    await coordinator.acceptAiDraft(aiDraft, 'signed-provenance')

    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith(aiDraft, 'signed-provenance')
  })

  it('serializes a manual edit behind AI acceptance so the manual edit wins', async () => {
    vi.useFakeTimers()
    let releaseAi!: () => void
    const aiPending = new Promise<void>((resolve) => {
      releaseAi = resolve
    })
    const calls: string[] = []
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save: async (snapshot, token) => {
        calls.push(token ? 'ai' : snapshot.text)
        if (token) await aiPending
      },
      onState: vi.fn(),
    })
    const aiDraft = { text: 'AI draft', languageTag: 'en-Latn' }
    const manualDraft = { text: 'Manual edit', languageTag: 'en-Latn' }

    const accepting = coordinator.acceptAiDraft(aiDraft, 'signed-provenance')
    coordinator.schedule(manualDraft)
    await vi.advanceTimersByTimeAsync(700)
    expect(calls).toEqual(['ai'])

    releaseAi()
    await accepting
    await coordinator.flush(manualDraft)
    expect(calls).toEqual(['ai', 'Manual edit'])
  })

  it('uses an updated save destination without resetting queued draft state', async () => {
    vi.useFakeTimers()
    const originalSave = vi.fn(async () => undefined)
    const updatedSave = vi.fn(async () => undefined)
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save: originalSave,
      onState: vi.fn(),
    })

    coordinator.schedule(changed)
    coordinator.setSave(updatedSave)
    await vi.advanceTimersByTimeAsync(700)

    expect(originalSave).not.toHaveBeenCalled()
    expect(updatedSave).toHaveBeenCalledWith(changed)
  })

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

  // StrictMode mounts, tears the mount down and mounts again against the SAME
  // coordinator — the one `useState` keeps — so teardown must be reversible.
  // While it latched the channel shut, `unsaved` and `error` (and with them
  // `Draft not saved` and `Retry save`) were unreachable in dev and in stories.
  it('keeps reporting status through a subscribe → unsubscribe → subscribe cycle', async () => {
    vi.useFakeTimers()
    const save = vi
      .fn<(snapshot: ReplyDraftSnapshot) => Promise<void>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined)
    const observed: ReplyAutosaveState[] = []
    const listener = (state: ReplyAutosaveState) => observed.push(state)
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save,
      onState: listener,
    })

    const detach = coordinator.subscribe(listener)
    detach()
    coordinator.dispose()
    coordinator.subscribe(listener)

    coordinator.schedule(changed)
    await vi.advanceTimersByTimeAsync(700)

    expect(observed.map((state) => state.status)).toEqual(['pending', 'saving', 'error'])
    expect(observed.at(-1)?.error).toBe(
      'Draft could not be saved. Retry before submitting.',
    )

    await coordinator.retry()

    expect(observed.at(-1)).toEqual({ status: 'saved', error: null })
  })

  it('stays silent after teardown until something subscribes again', () => {
    const observed: ReplyAutosaveState[] = []
    const listener = (state: ReplyAutosaveState) => observed.push(state)
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save: vi.fn(async () => undefined),
      onState: listener,
    })

    coordinator.dispose()
    coordinator.schedule(changed, false)

    expect(observed).toEqual([])

    coordinator.subscribe(listener)
    coordinator.schedule(changed, false)

    expect(observed).toEqual([{ status: 'unsaved', error: null }])
  })
})
