import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createReplyAutosaveCoordinator,
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
})
