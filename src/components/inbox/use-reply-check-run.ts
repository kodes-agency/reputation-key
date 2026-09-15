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
 * A settled check's reply, until it renders: its state key when the check
 * answered, or null after a rejection, whose re-read state is not known yet.
 */
type FocusRequest = Readonly<{ replyId: string; key: string | null }>

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
  const focusAfterCheck = useRef<FocusRequest | null>(null)

  // Cleared during render rather than hidden: the line is a live region, and a
  // stale sentence kept in state would be announced again the moment the
  // manager came back to the reply it was about. The clicked state still on
  // screen is not stale; it is the reply the answer has not replaced yet.
  if (line !== null && line.key !== lineKey && line.checkedFromKey !== lineKey) {
    setLine(null)
  }

  // A check whose answer changes the view (never sent → Try publishing again,
  // live → Edit reply) unmounts the focused button, and focus falls to <body>:
  // a keyboard user's next Tab restarts at the top of the page. After the
  // answer has rendered, a lost focus moves to the new primary action. It
  // waits for the reply the check returned — the cache write can render after
  // the check's own settle — and gives up on another reply, or once focus is
  // somewhere the manager put it.
  useEffect(() => {
    const request = focusAfterCheck.current
    const message = messageRef.current
    if (request === null) return
    if (request.replyId !== replyId) {
      focusAfterCheck.current = null
      return
    }
    const isShowing = request.key === null || request.key === lineKey
    if (!isShowing || checkingReplyId !== null || !message) return
    if (!isFocusLost(message)) {
      focusAfterCheck.current = null
      return
    }
    const action = primaryAction(message)
    if (!action) return
    focusAfterCheck.current = null
    action.focus()
  })

  const check = () => {
    if (replyId === null || lineKey === null) return
    const target = replyId
    const checkedFromKey = lineKey
    setCheckingReplyId(target)
    // Emptied as the check starts. A live region speaks only when its text
    // changes, so an answer identical to the line already there (the same
    // minute, or `Google no longer returns this review.`) would be silent.
    setLine(null)
    focusAfterCheck.current = null
    void onCheck()
      .then(
        (result) => {
          const feedback = replyCheckFeedback(result)
          const key = replyCheckLineKey(result.reply)
          focusAfterCheck.current = { replyId: target, key }
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
          focusAfterCheck.current = { replyId: target, key: null }
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
