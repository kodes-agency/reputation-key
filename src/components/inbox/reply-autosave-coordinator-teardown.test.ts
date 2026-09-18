// The coordinator's teardown write and its unknown-server-copy rule, in a file
// of their own: the base suite, `reply-autosave-coordinator.test.ts`, stands at
// the edge of the 300 counted lines ESLint `max-lines` allows under
// `src/components`. The fixtures repeat the base suite's rather than importing
// them: a test file exporting helpers would be a module other suites could
// start to lean on, and these are a few lines.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createReplyAutosaveCoordinator,
  type ReplyAutosaveState,
  type ReplyDraftSnapshot,
} from './reply-autosave-coordinator'

const initial: ReplyDraftSnapshot = { text: 'Initial', languageTag: 'en-Latn' }
const first: ReplyDraftSnapshot = { text: 'First words', languageTag: 'en-Latn' }
const more: ReplyDraftSnapshot = { text: 'First words, and more', languageTag: 'en-Latn' }

afterEach(() => vi.useRealTimers())

type Save = (snapshot: ReplyDraftSnapshot, provenanceToken?: string) => Promise<void>

/** A save whose first call parks until released; later calls resolve. */
function parkedSave() {
  let release: (() => void) | undefined
  const save = vi
    .fn<(snapshot: ReplyDraftSnapshot) => Promise<void>>()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    .mockResolvedValue(undefined)
  return { save, release: () => release?.() }
}

/** A save whose first call is refused; later calls resolve. */
function refusedOnceSave() {
  return vi
    .fn<Save>()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(undefined)
}

/** Type `first` and let its debounced save run — and, here, fail. */
async function failFirstSave(save: ReturnType<typeof refusedOnceSave>) {
  vi.useFakeTimers()
  const observed: ReplyAutosaveState[] = []
  const coordinator = createReplyAutosaveCoordinator({
    initial,
    save,
    onState: (state) => observed.push(state),
  })
  coordinator.schedule(first)
  await vi.advanceTimersByTimeAsync(700)
  expect(observed.at(-1)?.status).toBe('error')
  return coordinator
}

async function tearDown(coordinator: ReturnType<typeof createReplyAutosaveCoordinator>) {
  coordinator.flushOnTeardown()
  coordinator.dispose()
  await vi.advanceTimersByTimeAsync(0)
}

describe('flushOnTeardown', () => {
  it('writes text queued behind an in-flight save — once, after it', async () => {
    vi.useFakeTimers()
    const { save, release } = parkedSave()
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save,
      onState: vi.fn(),
    })

    coordinator.schedule(first)
    await vi.advanceTimersByTimeAsync(700)
    // The second debounce fires while `first` is still in flight, so `more`
    // is parked in `pending` — not in `scheduled`.
    coordinator.schedule(more)
    await vi.advanceTimersByTimeAsync(700)
    expect(save).toHaveBeenCalledTimes(1)

    coordinator.flushOnTeardown()
    coordinator.dispose()
    release()
    await vi.advanceTimersByTimeAsync(0)

    // Once: the drain loop must not also write it, and teardown must not drop it.
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith(more)
  })

  it('skips the write when the in-flight save already wrote exactly that text', async () => {
    vi.useFakeTimers()
    const { save, release } = parkedSave()
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save,
      onState: vi.fn(),
    })

    coordinator.schedule(first)
    await vi.advanceTimersByTimeAsync(700)
    // The same text scheduled again while it is being written.
    coordinator.schedule(first)
    coordinator.flushOnTeardown()
    coordinator.dispose()
    release()
    await vi.advanceTimersByTimeAsync(0)

    expect(save).toHaveBeenCalledTimes(1)
  })
})

describe('flushOnTeardown after a failed save', () => {
  it('does not retry the failed text: it may not be what the box shows', async () => {
    // A failed save leaves its text in `failed`, but that is not reliably the
    // box: a token-less `Use draft` saves the suggestion before the composer
    // adopts it, and a save can fail after `Delete draft`. The failure was
    // reported while the composer was open (`Not saved`, `Retry save`).
    const save = refusedOnceSave()
    const coordinator = await failFirstSave(save)

    await tearDown(coordinator)

    expect(save).toHaveBeenCalledTimes(1)
  })
})

describe('invalidate', () => {
  it('makes the next save real after the server was written outside the coordinator', async () => {
    // A template load writes the draft server-side; if its answer is dropped
    // (the manager moved on), the box still shows P. Submit's flush must then
    // write P rather than trust P as the server's copy.
    const observed: ReplyAutosaveState[] = []
    const save = vi.fn(async () => undefined)
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save,
      onState: (state) => observed.push(state),
    })
    await coordinator.flush(first)
    expect(save).toHaveBeenCalledTimes(1)

    coordinator.invalidate()
    coordinator.schedule(first)
    expect(observed.at(-1)?.status).toBe('pending')

    await coordinator.flush(first)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith(first)
  })

  it('does not let a save in flight when it ran confirm the server copy', async () => {
    // Clicking `Template` blurs the box, so the blur's flush is still in
    // flight when the load announces its server-side write. The load then
    // fails: the box shows `first`, the server may hold the template.
    const { save, release } = parkedSave()
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save,
      onState: vi.fn(),
    })
    const blurFlush = coordinator.flush(first)
    coordinator.invalidate()
    release()
    await blurFlush

    await coordinator.flush(first)

    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith(first)
  })

  it('does not let an AI draft save in flight when it ran confirm it either', async () => {
    const { save, release } = parkedSave()
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save,
      onState: vi.fn(),
    })
    const aiDraft = { text: 'AI draft', languageTag: 'en-Latn' }
    const accepting = coordinator.acceptAiDraft(aiDraft, 'signed-provenance')
    coordinator.invalidate()
    release()
    await accepting

    await coordinator.flush(aiDraft)

    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith(aiDraft)
  })

  it('queues a flush of the same text behind that save rather than joining it', async () => {
    // As above, but Submit's flush arrives while the blur's save is parked.
    const { save, release } = parkedSave()
    const coordinator = createReplyAutosaveCoordinator({
      initial,
      save,
      onState: vi.fn(),
    })
    const blurFlush = coordinator.flush(first)
    coordinator.invalidate()
    const submitFlush = coordinator.flush(first)
    release()
    await Promise.all([blurFlush, submitFlush])

    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith(first)
  })
})
