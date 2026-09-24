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

  it('stands the debounce down on teardown without firing the pending save', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => undefined)
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save,
      onState: vi.fn(),
    })

    coordinator.schedule(changed)
    coordinator.dispose()
    await vi.advanceTimersByTimeAsync(700)

    expect(save).not.toHaveBeenCalled()
  })

  it('sends a debounce that has not fired when the mount ends', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => undefined)
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save,
      onState: vi.fn(),
    })

    // Type, then tear the mount down inside the 700 ms window — the phone sheet
    // dismissed on Escape, which removes a focused textarea from the DOM and so
    // dispatches no `focusout` for the flush-on-blur to ride.
    coordinator.schedule(changed)
    coordinator.flushOnTeardown()
    coordinator.dispose()
    await vi.advanceTimersByTimeAsync(0)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(changed)
  })

  it('has nothing to send when the mount ends with no debounce running', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => undefined)
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save,
      onState: vi.fn(),
    })

    // StrictMode's first teardown runs before anyone has typed.
    coordinator.flushOnTeardown()
    coordinator.dispose()
    await vi.advanceTimersByTimeAsync(700)

    expect(save).not.toHaveBeenCalled()
  })

  it('writes text typed during an in-flight save once, after that save, on teardown', async () => {
    vi.useFakeTimers()
    let releaseFirst: (() => void) | undefined
    const save = vi
      .fn<(snapshot: ReplyDraftSnapshot) => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseFirst = resolve
          }),
      )
      .mockResolvedValue(undefined)
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save,
      onState: vi.fn(),
    })

    // The first edit reaches the server and parks there on a slow network.
    coordinator.schedule(changed)
    await vi.advanceTimersByTimeAsync(700)
    expect(save).toHaveBeenCalledTimes(1)

    // More words, then the sheet closes inside the debounce window.
    const second: ReplyDraftSnapshot = {
      text: 'Changed, and more',
      languageTag: 'en-Latn',
    }
    coordinator.schedule(second)
    coordinator.flushOnTeardown()
    coordinator.dispose()
    expect(save).toHaveBeenCalledTimes(1)

    // `dispose` cleared `pending`, so handing the text to `enqueue` would have
    // dropped it. Chained after the in-flight save, it lands — once.
    releaseFirst?.()
    await vi.advanceTimersByTimeAsync(0)

    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith(second)
  })
})
