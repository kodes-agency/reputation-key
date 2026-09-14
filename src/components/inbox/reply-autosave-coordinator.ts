export type ReplyDraftSnapshot = Readonly<{
  text: string
  languageTag: string | null
}>

export type ReplyAutosaveStatus =
  'idle' | 'pending' | 'saving' | 'saved' | 'unsaved' | 'error'

export type ReplyAutosaveState = Readonly<{
  status: ReplyAutosaveStatus
  error: string | null
}>
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
    onState: (state: ReplyAutosaveState) => void
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
  let save = input.save
  // The status channel is a replaceable slot, not a one-way latch. React
  // StrictMode tears the mount down and mounts it again against the SAME
  // coordinator — the one `useState` keeps — so an irreversible teardown flag
  // would drop every status for the rest of the component's life, `unsaved`
  // and `error` included. `dispose()` detaches the listener; `subscribe()`
  // re-attaches it.
  let listener: ((state: ReplyAutosaveState) => void) | null = input.onState
  const emit = (status: ReplyAutosaveStatus, error: string | null = null) => {
    listener?.({ status, error })
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
          await save(snapshot)
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
    /**
     * Attach the status listener, replacing any current one, and return its
     * detach. Detaching is idempotent and re-subscribing re-arms the channel.
     */
    subscribe(next: (state: ReplyAutosaveState) => void) {
      listener = next
      return () => {
        if (listener === next) listener = null
      }
    },
    setSave(nextSave: SaveDraft) {
      save = nextSave
    },
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
          await save(snapshot, provenanceToken)
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
      listener = null
      cancelTimer()
      pending = null
    },
  }
}
