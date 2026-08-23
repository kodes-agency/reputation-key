export type ReplyDraftSnapshot = Readonly<{
  text: string
  languageTag: string | null
}>

export type ReplyAutosaveStatus =
  'idle' | 'pending' | 'saving' | 'saved' | 'unsaved' | 'error'

type State = Readonly<{ status: ReplyAutosaveStatus; error: string | null }>
type SaveDraft = (
  snapshot: ReplyDraftSnapshot,
  provenanceToken?: string,
) => Promise<unknown>

const same = (left: ReplyDraftSnapshot, right: ReplyDraftSnapshot) =>
  left.text === right.text && left.languageTag === right.languageTag

export function createReplyAutosaveCoordinator(
  input: Readonly<{
    initial: ReplyDraftSnapshot
    save: SaveDraft
    onState: (state: State) => void
    delayMs?: number
  }>,
) {
  let lastSaved = input.initial
  let pending: ReplyDraftSnapshot | null = null
  let active: ReplyDraftSnapshot | null = null
  let failed: ReplyDraftSnapshot | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let draining: Promise<void> | null = null
  let accepting: Promise<void> | null = null
  let disposed = false
  const emit = (status: ReplyAutosaveStatus, error: string | null = null) => {
    if (!disposed) input.onState({ status, error })
  }
  const cancelTimer = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  const drain = async (): Promise<void> => {
    if (draining) return draining
    if (accepting) await accepting
    if (draining) return draining
    const work = (async () => {
      while (pending) {
        const snapshot = pending
        pending = null
        active = snapshot
        emit('saving')
        try {
          await input.save(snapshot)
          lastSaved = snapshot
          failed = null
          emit(pending ? 'pending' : 'saved')
        } catch {
          failed = pending ?? snapshot
          pending = null
          emit('error', 'Draft could not be saved. Retry before submitting.')
          throw new Error('Draft autosave failed')
        } finally {
          active = null
        }
      }
    })()
    draining = work
    try {
      await work
    } finally {
      draining = null
    }
  }
  const enqueue = async (snapshot: ReplyDraftSnapshot) => {
    if (same(snapshot, lastSaved)) return
    if (active && same(snapshot, active) && draining) return draining
    pending = snapshot
    failed = null
    await drain()
  }

  return {
    schedule(snapshot: ReplyDraftSnapshot, eligible = true) {
      cancelTimer()
      pending = null
      if (!eligible) return emit('unsaved')
      if (same(snapshot, lastSaved)) return emit('saved')
      emit('pending')
      timer = setTimeout(() => {
        timer = null
        void enqueue(snapshot).catch(() => undefined)
      }, input.delayMs ?? 700)
    },
    async flush(snapshot: ReplyDraftSnapshot) {
      cancelTimer()
      if (!same(snapshot, lastSaved)) await enqueue(snapshot)
      else if (draining) await draining
      if (failed) throw new Error('Draft autosave failed')
    },
    async acceptAiDraft(snapshot: ReplyDraftSnapshot, provenanceToken: string) {
      cancelTimer()
      if (accepting) await accepting
      if (draining) await draining
      const work = (async () => {
        emit('saving')
        try {
          await input.save(snapshot, provenanceToken)
          lastSaved = snapshot
          failed = null
          emit('saved')
        } catch {
          failed = snapshot
          emit('error', 'AI draft could not be saved. Your previous draft is unchanged.')
          throw new Error('AI draft save failed')
        }
      })()
      accepting = work
      try {
        await work
      } finally {
        accepting = null
      }
    },
    async retry() {
      if (failed) await enqueue(failed)
    },
    dispose() {
      disposed = true
      cancelTimer()
      pending = null
    },
  }
}
