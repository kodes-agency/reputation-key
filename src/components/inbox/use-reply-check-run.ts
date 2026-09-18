import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ReplyPublicationCheckResult } from '#/contexts/review/application/public-api'
import {
  replyCheckFeedback,
  replyCheckLineKey,
  type ReplyCheckLineSubject,
} from './reply-check-feedback'

/**
 * A status sentence, the reply state (`replyCheckLineKey`) it describes, and
 * the state the reply was in when the check was clicked. The two differ when
 * the answer moved the reply, and the cache write that shows the new state can
 * render after the check settles (TanStack's notify scheduler is a macrotask).
 */
type KeyedLine = Readonly<{ key: string; checkedFromKey: string; message: string }>

/**
 * A settled action's reply, until it renders: the state key the answer left it
 * in, or null when that state is not known yet (a refused check, whose re-read
 * has not landed).
 */
type FocusRequest = Readonly<{ replyId: string; key: string | null }>

export type ReplyFocusReturn = Readonly<{
  /** Return focus once `replyId` renders in the state `key` names (null: any). */
  request: (replyId: string, key: string | null) => void
  /** Forget a pending request: a new action on this reply is starting. */
  cancel: () => void
}>

export type ReplyCheckRun = Readonly<{
  /** THIS reply's check is in flight — not merely some write in the pane. */
  isChecking: boolean
  /** The status line's words for this reply, or null for an empty line. */
  statusMessage: string | null
  check: () => void
}>

/**
 * The reply's first usable action, or nothing. `[data-reply-actions]` is the
 * action row `ReplyMessageActions` renders; a disabled button cannot take
 * focus, so the caller waits for a render in which one is enabled.
 */
function primaryAction(message: HTMLElement | null): HTMLElement | null {
  return (
    message?.querySelector<HTMLElement>('[data-reply-actions] button:not(:disabled)') ??
    null
  )
}

/** True when the page has no focused element left: it fell back to <body>. */
function isFocusLost(message: HTMLElement): boolean {
  const active = message.ownerDocument.activeElement
  return active === null || active === message.ownerDocument.body || !active.isConnected
}

/**
 * Puts focus back in a reply message after an action's answer took it away.
 *
 * An answer that changes the view (a check: never sent → Try publishing again,
 * live → Edit reply; a reject: → Edit & resubmit) unmounts the focused button,
 * and focus falls to <body>: a keyboard user's next Tab restarts at the top of
 * the page. After the answer has rendered, a lost focus moves to the new
 * primary action. Callers hold this above the action row, which `ReplyMessage`
 * keys by `${reply.id}:${reply.status}`, so a request survives the remount a
 * new status causes.
 *
 * `key` is the caller's name for the state on screen, compared with the key a
 * request waits for. The request waits for that state — the cache write can
 * render after the action's own settle — and for `isBusy` to clear, and gives
 * up on another reply, or once focus is somewhere the manager put it.
 */
export function useReplyFocusReturn(
  messageRef: RefObject<HTMLElement | null>,
  replyId: string | null,
  key: string | null,
  isBusy: boolean,
): ReplyFocusReturn {
  const pending = useRef<FocusRequest | null>(null)

  useEffect(() => {
    const request = pending.current
    const message = messageRef.current
    if (request === null) return
    if (request.replyId !== replyId) {
      pending.current = null
      return
    }
    const isShowing = request.key === null || request.key === key
    if (!isShowing || isBusy || !message) return
    if (!isFocusLost(message)) {
      pending.current = null
      return
    }
    const action = primaryAction(message)
    if (!action) return
    pending.current = null
    action.focus()
  })

  return {
    request: (target, expectedKey) => {
      pending.current = { replyId: target, key: expectedKey }
    },
    cancel: () => {
      pending.current = null
    },
  }
}

/**
 * One "Check Google again" for the reply a message is showing: its pending
 * state, the status line its answer leaves behind, and where focus goes after.
 *
 * Owned by `ReplyMessage`, not by `ReplyMessageActions`, because the action row
 * is keyed by `${reply.id}:${reply.status}` (reply-message.tsx) and remounts
 * whenever a check moves the reply on — a line held there would be erased by
 * the very result it reports. `ReplyMessage` is not remounted: it sits under a
 * thread row keyed by the constant `'reply'` in a thread the pane mounts once
 * (inbox-thread.tsx), so it outlives both a new server reply and a change of
 * item. That is why the line carries the reply state it was written for: a
 * finding about one reply must not print under another, nor under the same
 * reply once a poll has moved it on (`Live on Google`, or `has stopped
 * checking automatically` above a line promising another check).
 *
 * The toasts and the cache patch belong to the mutation
 * (`replyCheckMutationOptions`); this reads the same `replyCheckFeedback` for
 * the outcomes that stay on the line, so the two can never both speak.
 */
export function useReplyCheckRun(
  reply: ReplyCheckLineSubject | null,
  onCheck: () => Promise<ReplyPublicationCheckResult>,
  messageRef: RefObject<HTMLElement | null>,
): ReplyCheckRun {
  const replyId = reply?.id ?? null
  const lineKey = reply ? replyCheckLineKey(reply) : null
  const [checkingReplyId, setCheckingReplyId] = useState<string | null>(null)
  const [line, setLine] = useState<KeyedLine | null>(null)
  // Keyed by `replyCheckLineKey`: it waits for the reply the check returned.
  const focusAfterCheck = useReplyFocusReturn(
    messageRef,
    replyId,
    lineKey,
    checkingReplyId !== null,
  )

  // Cleared during render rather than hidden: the line is a live region, and a
  // stale sentence kept in state would be announced again the moment the
  // manager came back to the reply it was about. The clicked state still on
  // screen is not stale; it is the reply the answer has not replaced yet.
  if (line !== null && line.key !== lineKey && line.checkedFromKey !== lineKey) {
    setLine(null)
  }

  const check = () => {
    if (replyId === null || lineKey === null) return
    const target = replyId
    const checkedFromKey = lineKey
    setCheckingReplyId(target)
    // Emptied as the check starts. A live region speaks only when its text
    // changes, so an answer identical to the line already there (the same
    // minute, or `Google no longer returns this review.`) would be silent.
    setLine(null)
    focusAfterCheck.cancel()
    void onCheck()
      .then(
        (result) => {
          const feedback = replyCheckFeedback(result)
          const key = replyCheckLineKey(result.reply)
          focusAfterCheck.request(target, key)
          setLine(
            feedback.kind === 'status'
              ? { key, checkedFromKey, message: feedback.message }
              : null,
          )
        },
        // Reported, not swallowed: the check mutation opts into `errorMessage`
        // (use-reply-actions.ts), which toasts before this rejection arrives,
        // and re-reads the reply (`onReplyCheckFailed`).
        () => {
          focusAfterCheck.request(target, null)
        },
      )
      .finally(() => {
        setCheckingReplyId((current) => (current === target ? null : current))
      })
  }

  return {
    isChecking: checkingReplyId !== null && checkingReplyId === replyId,
    statusMessage: line?.key === lineKey ? line.message : null,
    check,
  }
}
