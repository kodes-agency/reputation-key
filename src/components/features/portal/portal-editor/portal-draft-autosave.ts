// The portal editor's autosave coordinator. Framework-free on purpose: it is
// the one place that decides when an edit becomes a write, so it runs in the
// Node unit project with fake timers.
//
// One coordinator serves one portal. Every form or control that autosaves
// registers a keyed save (`schedule`); the coordinator debounces each key on
// its own clock and then runs the saves ONE AT A TIME, in the order their
// debounces fired. That serialising is the point of "per portal": Welcome,
// Private note and the theme all patch the same portal row, and two writes in
// flight would race the optimistic cache update and each other's refetch.
//
// It reports three answers the editor needs:
//   - a status for the header ("Saving…", "Draft saved", "Not saved"),
//   - `hasUnsaved`: anything not yet safely on the server — for the browser's
//     leave-the-page prompt,
//   - `needsAttention`: a failed or refused save, or an explicit-save form with
//     edits — what makes an in-app navigation ask first. A keystroke that is
//     merely waiting out its debounce does not: `flush` writes it before the
//     navigation is allowed to continue.

export const PORTAL_DRAFT_AUTOSAVE_DELAY_MS = 800

/**
 * What one write came to. `invalid` means the form itself refused the values
 * (its submit-time schema), which is not a failure to retry but an edit the
 * person still has to fix. `unchanged` means the server already held these
 * values, so nothing was written and there is nothing new to announce.
 */
export type PortalDraftSaveOutcome = 'saved' | 'unchanged' | 'invalid'
export type PortalDraftSave = () => Promise<PortalDraftSaveOutcome>

export type PortalDraftAutosaveStatus =
  'idle' | 'pending' | 'saving' | 'saved' | 'invalid' | 'error'

export type PortalDraftAutosaveState = Readonly<{
  status: PortalDraftAutosaveStatus
  /** When the last write landed (ms since the epoch), or null before the first. */
  savedAt: number | null
  /** The last failed write's error while status is `error`, else null. */
  error: unknown
}>

const IDLE_STATE: PortalDraftAutosaveState = {
  status: 'idle',
  savedAt: null,
  error: null,
}

type Timer = ReturnType<typeof setTimeout>

type Scheduled = Readonly<{ save: PortalDraftSave; timer: Timer }>

export type PortalDraftAutosaveOptions = Readonly<{
  delayMs?: number
  now?: () => number
}>

export type PortalDraftAutosave = ReturnType<typeof createPortalDraftAutosave>

/**
 * The keys of what only the person can resolve, by cause: a write that failed
 * (a retry may put it right), values a form refused, and explicit-save edits.
 */
export type PortalDraftAttention = Readonly<{
  failed: ReadonlyArray<string>
  invalid: ReadonlyArray<string>
  explicit: ReadonlyArray<string>
}>

export function createPortalDraftAutosave(options: PortalDraftAutosaveOptions = {}) {
  const delayMs = options.delayMs ?? PORTAL_DRAFT_AUTOSAVE_DELAY_MS
  const now = options.now ?? Date.now

  const scheduled = new Map<string, Scheduled>()
  /** Bumped by every `schedule`, so a late result can tell it has been overtaken. */
  const versions = new Map<string, number>()
  const failed = new Map<string, PortalDraftSave>()
  const invalid = new Set<string>()
  const explicit = new Map<string, () => boolean>()
  const listeners = new Set<() => void>()
  const discardListeners = new Set<(keys: ReadonlySet<string>) => void>()

  /** Saves queued or running: enqueued synchronously, so it covers the wait too. */
  let inFlight = 0
  let savedAt: number | null = null
  let lastError: unknown = null
  let queue: Promise<void> = Promise.resolve()
  let state: PortalDraftAutosaveState = IDLE_STATE

  const derive = (): PortalDraftAutosaveState => {
    if (inFlight > 0) return { status: 'saving', savedAt, error: null }
    if (failed.size > 0) return { status: 'error', savedAt, error: lastError }
    if (invalid.size > 0) return { status: 'invalid', savedAt, error: null }
    if (scheduled.size > 0) return { status: 'pending', savedAt, error: null }
    return savedAt === null ? IDLE_STATE : { status: 'saved', savedAt, error: null }
  }

  const publish = () => {
    const next = derive()
    if (
      next.status === state.status &&
      next.savedAt === state.savedAt &&
      next.error === state.error
    ) {
      return
    }
    state = next
    for (const listener of [...listeners]) listener()
  }

  const versionOf = (key: string) => versions.get(key) ?? 0

  const hasDirtyExplicitForm = () => [...explicit.values()].some((isDirty) => isDirty())

  const enqueue = (key: string, save: PortalDraftSave): Promise<void> => {
    const version = versionOf(key)
    inFlight += 1
    queue = queue.then(async () => {
      try {
        const outcome = await save()
        if (outcome === 'saved') savedAt = now()
        if (versionOf(key) === version) {
          failed.delete(key)
          if (outcome === 'invalid') invalid.add(key)
          else invalid.delete(key)
        }
      } catch (error) {
        // A newer edit for the same key is already waiting: the failure is
        // about text nobody wants written any more.
        if (versionOf(key) === version) {
          failed.set(key, save)
          lastError = error
        }
      } finally {
        inFlight -= 1
        publish()
      }
    })
    return queue
  }

  const fire = (key: string) => {
    const entry = scheduled.get(key)
    if (!entry) return
    clearTimeout(entry.timer)
    scheduled.delete(key)
    void enqueue(key, entry.save)
    publish()
  }

  // Every member is a closure over the maps above and none reads `this`, so a
  // caller may pass one on as a callback (`subscribe`, `hasUnsaved`) as it is.
  return {
    /**
     * Register an edit. `save` is called after `delayMs` of quiet for this key,
     * so it must read the CURRENT values when it runs, not when it was created.
     */
    schedule(key: string, save: PortalDraftSave): void {
      const previous = scheduled.get(key)
      if (previous) clearTimeout(previous.timer)
      versions.set(key, versionOf(key) + 1)
      failed.delete(key)
      invalid.delete(key)
      scheduled.set(key, { save, timer: setTimeout(() => fire(key), delayMs) })
      publish()
    },

    /**
     * Write everything that is waiting now, and resolve once the queue is
     * drained. Never rejects: a failure is state (`needsAttention`), and the
     * caller — a navigation guard — needs the answer, not an exception.
     */
    async flush(): Promise<void> {
      for (const key of [...scheduled.keys()]) fire(key)
      await queue
    },

    /** Write every failed save again, now. */
    async retry(): Promise<void> {
      for (const [key, save] of [...failed]) {
        failed.delete(key)
        void enqueue(key, save)
      }
      publish()
      await queue
    },

    /**
     * Forget every failed or refused save, because the person chose to leave
     * without them. Without this a discarded edit would keep the header saying
     * "Not saved" and ask again on the next navigation.
     */
    discard(): void {
      const given = new Set([...failed.keys(), ...invalid])
      failed.clear()
      invalid.clear()
      publish()
      if (given.size === 0) return
      for (const listener of [...discardListeners]) listener(given)
    },

    /**
     * Hear which saves `discard` gave up. An edit that lives outside the
     * coordinator (the palette draft, which the preview reads) must be dropped
     * with it, or it would keep showing something that will never be written.
     * Returns the function that stops listening.
     */
    onDiscard(listener: (keys: ReadonlySet<string>) => void): () => void {
      discardListeners.add(listener)
      return () => {
        discardListeners.delete(listener)
      }
    },

    /**
     * Track a form that keeps an explicit Save (property-wide fields). It is
     * never written for the person, but leaving with edits in it must ask.
     * Returns the function that stops tracking it.
     */
    guardExplicit(key: string, isDirty: () => boolean): () => void {
      explicit.set(key, isDirty)
      return () => {
        if (explicit.get(key) === isDirty) explicit.delete(key)
      }
    },

    /** Anything not yet safely on the server, including a debounce still running. */
    hasUnsaved(): boolean {
      return (
        scheduled.size > 0 ||
        inFlight > 0 ||
        failed.size > 0 ||
        invalid.size > 0 ||
        hasDirtyExplicitForm()
      )
    },

    /** Something only the person can resolve: a failed or refused save, or unsaved explicit edits. */
    needsAttention(): boolean {
      return failed.size > 0 || invalid.size > 0 || hasDirtyExplicitForm()
    },

    /** Which saves need the person, by cause, so a prompt can name them. */
    attention(): PortalDraftAttention {
      return {
        failed: [...failed.keys()],
        invalid: [...invalid],
        explicit: [...explicit].filter(([, isDirty]) => isDirty()).map(([key]) => key),
      }
    },

    getState(): PortalDraftAutosaveState {
      return state
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    /**
     * Send edits still inside their debounce when the editor unmounts. A save
     * that already failed is not retried: it was reported while the editor was
     * open, and writing it now could put back text the person had moved on
     * from. Nothing waiting — every StrictMode teardown — is a no-op.
     */
    flushOnTeardown(): void {
      for (const key of [...scheduled.keys()]) fire(key)
    },
  }
}
