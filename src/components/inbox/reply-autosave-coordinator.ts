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

const same = (left: ReplyDraftSnapshot, right: ReplyDraftSnapshot | null) =>
  right !== null && left.text === right.text && left.languageTag === right.languageTag

export function createReplyAutosaveCoordinator(
  input: Readonly<{
    initial: ReplyDraftSnapshot
    save: SaveDraft
    onState: (state: ReplyAutosaveState) => void
    delayMs?: number
  }>,
) {
  /**
   * What the server is KNOWN to hold, or `null` once that is no longer known.
   *
   * A failed save does not prove the server kept the previous text: the request
   * may have landed before it failed, and a template load writes the draft
   * outside this coordinator altogether (`loadReplyTemplate` saves before the
   * composer's own flush runs). While this was left pointing at the last
   * success, a failed save followed by Undo read as `Saved` and let Submit skip
   * the save — so the server's copy, not the box's, went for approval. `null`
   * matches nothing, so after any failure the next `schedule` or `flush` writes
   * the box for real, and only a successful save re-establishes it — one that
   * no `invalidate()` overtook while it was in flight.
   */
  let lastSaved: ReplyDraftSnapshot | null = input.initial
  let pending: ReplyDraftSnapshot | null = null
  let active: ReplyDraftSnapshot | null = null
  let failed: ReplyDraftSnapshot | null = null
  /**
   * Bumped by `invalidate()`. A save records it when it starts and confirms
   * `lastSaved` only if it is unchanged when the save lands; see `invalidate`.
   */
  let generation = 0
  /** The `generation` the save in `active` started in. */
  let activeGeneration = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  /**
   * The snapshot a running debounce is holding, kept OUTSIDE the timer closure
   * so teardown can still reach it. `pending` is not this: `schedule` clears
   * `pending` and only `enqueue` sets it, so between a keystroke and the timer
   * firing the words lived nowhere the coordinator could find them, and an
   * unmount inside that window discarded them with `cancelTimer()`.
   */
  let scheduled: ReplyDraftSnapshot | null = null
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
    scheduled = null
  }
  const drain = async (): Promise<void> => {
    if (draining) return draining
    if (accepting) await accepting
    if (draining) return draining
    const work = (async () => {
      while (pending) {
        const snapshot = pending
        const startedIn = generation
        pending = null
        active = snapshot
        activeGeneration = startedIn
        emit('saving')
        try {
          await save(snapshot)
          if (startedIn === generation) lastSaved = snapshot
          failed = null
          emit(pending ? 'pending' : 'saved')
        } catch {
          failed = pending ?? snapshot
          pending = null
          lastSaved = null
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
    // Joining the save in flight is sound only while it can still confirm the
    // server's copy. One an `invalidate()` overtook cannot, so the same text
    // is queued to be written again after it instead.
    const joinable = active && same(snapshot, active) && activeGeneration === generation
    if (joinable && draining) return draining
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
      // A failed save that is still on screen keeps saying so. `schedule` runs
      // on every keystroke AND on every language change, and it repainted the
      // head unconditionally — so picking a language after a failure replaced
      // `Draft could not be saved` with a bare `Not saved` and took
      // `Retry save` (gated on `status === 'error'`) with it, while the
      // coordinator still held the unsaved snapshot and `flush` still refused.
      //
      // Once the text moves on, the failed snapshot is no longer what anyone
      // wants written, so it is dropped and the new save speaks for itself.
      if (failed && same(snapshot, failed)) {
        return emit('error', 'Draft could not be saved. Retry before submitting.')
      }
      if (!eligible) return emit('unsaved')
      if (same(snapshot, lastSaved)) return emit('saved')
      emit('pending')
      scheduled = snapshot
      timer = setTimeout(() => {
        timer = null
        scheduled = null
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
      const startedIn = generation
      const work = (async () => {
        emit('saving')
        try {
          await save(snapshot, provenanceToken)
          if (startedIn === generation) lastSaved = snapshot
          failed = null
          emit('saved')
        } catch {
          failed = snapshot
          lastSaved = null
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
    /**
     * Forget which copy the server holds, because something outside this
     * coordinator is about to write it. A template load does: `loadReplyTemplate`
     * saves the template as the draft server-side before the composer hears
     * back, so a load that fails after writing, or whose answer is dropped
     * because the manager moved on, left `lastSaved` naming text the server no
     * longer had — and Submit, skipping the "unchanged" save, sent the template.
     * With nothing confirmed, the next `schedule` or `flush` writes the box.
     *
     * That includes a save already in flight when this runs, which clicking
     * `Template` makes likely: the click blurs the box, and the blur's flush
     * starts a save. It began before the outside write, so its success says
     * nothing about which of the two the server kept: it no longer re-confirms
     * `lastSaved` (`generation`), and a flush of the same text queues behind
     * it rather than joining it.
     */
    invalidate() {
      generation += 1
      lastSaved = null
    },
    /**
     * Send the latest unsaved text on teardown, wherever it currently sits.
     *
     * It is in one of two places. A keystroke inside the 700 ms debounce is in
     * `scheduled` (never in `pending`: `schedule` clears that and only `enqueue`
     * sets it). Text whose debounce FIRED while a save was already in flight
     * is in `pending`, parked behind that save. Removing a FOCUSED textarea from the
     * DOM dispatches no `focusout`, so flush-on-blur rides neither exit —
     * dismissing the phone sheet on Escape, or a selection change that never
     * blurred the box, took the words with it.
     *
     * The write is chained AFTER whatever is in flight rather than handed to
     * `enqueue`, because `dispose()` runs next and clears `pending`. It is the
     * last text on screen, so it wins; it is skipped only if an in-flight save
     * already wrote exactly this. Fire-and-forget: nobody is left to tell.
     *
     * A save that already FAILED is not retried here, on purpose. `failed` is
     * not reliably the text on screen: a `Use draft` of a suggestion without a
     * provenance token saves through `enqueue` before the composer adopts it,
     * so when that save fails `failed` holds words the manager never took; and
     * a save failing after `Delete draft` would put the deleted reply back.
     * The failure was reported (`Not saved`, `Retry save`) while the composer
     * was open.
     *
     * Unmounting is not abandoning. The unmounts this covers — the sheet
     * closing, a change of selection — are ones where the manager expects an
     * autosaved draft to be kept, and deleting a draft does not unmount the
     * composer at all (`ReplyCompose` is not keyed, and a deleted draft stays on
     * the `compose` arm), so this cannot resurrect a deleted reply.
     *
     * A no-op when nothing is unsaved, which is every StrictMode teardown: the
     * first cleanup runs before anyone has typed.
     */
    flushOnTeardown() {
      const latest = scheduled ?? pending
      cancelTimer()
      pending = null
      if (!latest) return
      void Promise.allSettled([draining, accepting])
        .then(() => (same(latest, lastSaved) ? undefined : save(latest)))
        .catch(() => undefined)
    },
    /**
     * Detach the status channel and stand everything down: the timer, and any
     * snapshot parked in `pending`. The hook calls `flushOnTeardown` first, so
     * by the time this runs any unsaved text has already been taken over; on
     * its own it discards.
     */
    dispose() {
      listener = null
      cancelTimer()
      pending = null
    },
  }
}
