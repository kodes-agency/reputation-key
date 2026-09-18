import { useEffect, useState } from 'react'
import {
  createReplyAutosaveCoordinator,
  type ReplyAutosaveState,
  type ReplyAutosaveStatus,
  type ReplyDraftSnapshot,
} from './reply-autosave-coordinator'

export type { ReplyAutosaveState, ReplyAutosaveStatus, ReplyDraftSnapshot }

type SaveDraft = (
  snapshot: ReplyDraftSnapshot,
  provenanceToken?: string,
) => Promise<unknown>

/** The slice of the coordinator one mount of the composer owns. */
type AutosaveLifecycle = Readonly<{
  subscribe: (listener: (state: ReplyAutosaveState) => void) => () => void
  flushOnTeardown: () => void
  dispose: () => void
}>

/**
 * One mount of the autosave status channel: subscribe, and on teardown send
 * any unsaved text, then detach the listener and stand the timer down.
 *
 * Teardown must leave the coordinator usable. StrictMode runs mount → teardown
 * → mount against the same instance (the one `useState` keeps), and before this
 * was reversible the teardown latched the channel shut before the first
 * keystroke, so `unsaved` and `error` — and with them `Draft not saved` and
 * `Retry save` — never reached the footer in development or in any story.
 *
 * Exported because the unit project runs in Node with no renderer: this is the
 * effect body itself, so a test can drive the StrictMode cycle directly.
 */
export function attachReplyAutosave(
  coordinator: AutosaveLifecycle,
  onState: (state: ReplyAutosaveState) => void,
) {
  const unsubscribe = coordinator.subscribe(onState)
  return () => {
    // Hand the latest unsaved text to the server BEFORE standing the
    // coordinator down. `dispose` cancels the timer and clears `pending`, so
    // without this line a keystroke inside the 700 ms window — or typed while
    // a save was in flight — was discarded by the very teardown that should
    // have saved it, silently, because the listener is detached next.
    coordinator.flushOnTeardown()
    unsubscribe()
    coordinator.dispose()
  }
}

export function useReplyAutosave(initial: ReplyDraftSnapshot, saveDraft: SaveDraft) {
  const [state, setState] = useState<ReplyAutosaveState>({
    status: 'idle',
    error: null,
  })
  const [coordinator] = useState(() =>
    createReplyAutosaveCoordinator({
      initial,
      save: saveDraft,
      onState: setState,
    }),
  )

  useEffect(() => coordinator.setSave(saveDraft), [coordinator, saveDraft])
  useEffect(() => attachReplyAutosave(coordinator, setState), [coordinator])

  return {
    status: state.status,
    error: state.error,
    schedule: coordinator.schedule,
    flush: coordinator.flush,
    acceptAiDraft: coordinator.acceptAiDraft,
    retry: coordinator.retry,
    invalidate: coordinator.invalidate,
  }
}
