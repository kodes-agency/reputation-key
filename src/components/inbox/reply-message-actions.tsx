// Inbox thread — the action row under the property's reply message.
//
// Split out of `reply-message.tsx` so the message itself stays a message: this
// half owns the two pieces of local state a reply message must NOT own (a
// revealed reject panel and the half-typed reason in it), the publish fence,
// and the disclosure relationship between a trigger here and an editor that
// mounts in a different subtree at the foot of the pane's scroller.

import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import { unfilledReplySlotsMessage } from '#/contexts/review/application/public-api'
import type { ReplyMessageAction } from './reply-message-view'
import type { ReactNode, RefObject } from 'react'
import type { ReplyDraftCheckDto } from '#/contexts/review/application/dto/reply-library.dto'
import {
  ReplyMessagePublishAction,
  ReplyMessagePublishFeedback,
} from './reply-message-publish-action'

/**
 * Which reply a confirmation is for: the reply, and the state revision of the
 * copy the manager read. Both, because the revision is counted per reply and
 * starts again for a new one: a reply that was deleted and written anew can
 * stand at the revision the first one stood at, with other text.
 */
export type ReplyOnScreen = Readonly<{ id: string; stateRevision: number }>

export type ReplyMessageActionsProps = Readonly<{
  actions: readonly ReplyMessageAction[]
  /** The SERVER copy of the reply — the same text the publish fence reads. */
  text: string
  /**
   * Which reply `text` is, and at which state revision. Null for a reply
   * Google shows, which is never confirmed here.
   */
  shown: ReplyOnScreen | null
  isSaving: boolean
  draftChecks: ReplyDraftCheckDto | null
  /**
   * This reply's check is in flight. Separate from `isSaving`, which is true
   * while ANY reply write in the pane is: only the check itself may say
   * `Checking Google…`.
   */
  isChecking: boolean
  /**
   * Whether the pane is currently showing the published reply's editor. This is
   * the pane's `editTarget`, not a flag either surface owns: the editor mounts
   * at the foot of the scroller, in a different subtree from the trigger below
   * that opens it, so nothing local to this row can see it.
   */
  isEditing: boolean
  /** Confirms the reply the manager read; see `shown`. */
  onApprove: (expectedReply: ReplyOnScreen) => Promise<unknown>
  onReject: (reason?: string) => Promise<unknown>
  /** Starts the check; its answer is reported by `ReplyMessage`, not here. */
  onCheck: () => void
  onRetry: () => Promise<unknown>
  onEditPublished: () => void
  onEditRejected: () => void
}>

/**
 * Approve and reject are one interaction, so they are rendered as a pair by
 * `ReplyMessageActions` rather than here; everything else in the union is a
 * single button. The dialog is a product invariant, not decoration: a
 * confirmation must be unreachable without it.
 */
function SimpleAction({
  action,
  isSaving,
  isChecking,
  isEditing,
  onCheck,
  onRetry,
  onEditPublished,
  onEditRejected,
}: ReplyMessageActionsProps & Readonly<{ action: ReplyMessageAction }>): ReactNode {
  switch (action) {
    case 'check':
      return (
        <Button
          size="sm"
          // A read of Google takes seconds. The Button's pending state (spinner,
          // `aria-busy`, disabled) and the name change say the click was taken.
          pending={isChecking}
          pendingLabel="Checking Google…"
          disabled={isSaving}
          onClick={onCheck}
        >
          Check Google again
        </Button>
      )
    case 'retry':
      return (
        <Button
          size="sm"
          pending={isSaving}
          pendingLabel="Starting…"
          // The retry mutation toasts a refusal (use-reply-actions.ts
          // `errorMessage`); the catch only keeps the rejection handled.
          onClick={() => void onRetry().catch(() => undefined)}
        >
          Try publishing again
        </Button>
      )
    case 'editPublished':
      return (
        <Button
          size="sm"
          variant="outline"
          disabled={isSaving}
          // This trigger really is a disclosure: the editor it opens mounts at
          // the foot of the scroller, in a different subtree, and the message
          // — including this button — keeps rendering while it is open. Without
          // the state the only report that the click did anything is a caret
          // that moved somewhere off screen.
          aria-expanded={isEditing}
          onClick={onEditPublished}
        >
          Edit reply
        </Button>
      )
    case 'editRejected':
      return (
        <Button
          size="sm"
          variant="outline"
          disabled={isSaving}
          // Deliberately NOT a disclosure, and deliberately not
          // `aria-expanded={false}`. Reopening a rejected reply is a
          // `draftReplyFn` round trip: the drafted reply re-resolves the view
          // to `compose`, so this whole message unmounts before any editor
          // exists — the composer that replaces it is not this button's
          // controlled region. A permanently false `aria-expanded` would
          // promise a disclosure that can never be observed to open.
          onClick={onEditRejected}
        >
          Edit &amp; resubmit
        </Button>
      )
    default:
      return null
  }
}

function RejectAction({
  canReject,
  isSaving,
  expanded,
  triggerRef,
  onOpen,
}: Readonly<{
  canReject: boolean
  isSaving: boolean
  expanded: boolean
  triggerRef: RefObject<HTMLButtonElement | null>
  onOpen: () => void
}>): ReactNode {
  if (!canReject) return null
  return (
    <Button
      size="sm"
      variant="destructive"
      disabled={isSaving}
      aria-expanded={expanded}
      ref={triggerRef}
      onClick={onOpen}
    >
      Reject
    </Button>
  )
}

function RejectPanel({
  shown,
  canReject,
  isSaving,
  reason,
  reasonId,
  reasonRef,
  onReasonChange,
  onReject,
  onCancel,
}: Readonly<{
  shown: boolean
  canReject: boolean
  isSaving: boolean
  reason: string
  reasonId: string
  reasonRef: RefObject<HTMLTextAreaElement | null>
  onReasonChange: (reason: string) => void
  onReject: ReplyMessageActionsProps['onReject']
  onCancel: () => void
}>): ReactNode {
  if (!shown || !canReject) return null
  return (
    <div className="mt-3 space-y-2">
      <Label htmlFor={reasonId} className="text-xs font-medium">
        Reason for rejection (optional)
      </Label>
      <Textarea
        id={reasonId}
        ref={reasonRef}
        placeholder="Reason for rejection (optional)..."
        value={reason}
        onChange={(event) => onReasonChange(event.target.value)}
        rows={2}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          disabled={isSaving}
          onClick={() => void onReject(reason || undefined).catch(() => undefined)}
        >
          Confirm rejection
        </Button>
        <Button size="sm" variant="ghost" disabled={isSaving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/**
 * The action row, plus the two things that must be said next to it: why a
 * publish is blocked, and the reason a reject is being given.
 *
 * Two a11y rules are load-bearing here. A natively `disabled` button leaves the
 * tab order and takes its `aria-describedby` with it, so the blocked publish is
 * `aria-disabled` and refuses the click instead — the explanation is reachable
 * only while the control is. And that explanation is NOT a live region: it is
 * present from first render, so `role="status"` would announce nothing.
 *
 * The reject panel is gated on the reject ACTION, not only on the local flag,
 * and the caller keys this component by reply identity. Both are needed: this
 * component sits at a fixed position in a thread row keyed by the constant
 * `'reply'`, so without them React carries a half-typed rejection reason across
 * the rejection it performed, and across a change of item.
 */
export function ReplyMessageActions(props: ReplyMessageActionsProps): ReactNode {
  const { actions, text, shown, isSaving, draftChecks, onApprove, onReject } = props
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const approvable = actions.includes('approve') ? shown : null
  const canReject = actions.includes('reject')
  // The fence reads the reply as the SERVER holds it, not any local text: this
  // message never owns an editor, and `approveReply` re-runs the same check.
  const publishBlockedReason =
    approvable !== null
      ? draftChecks && draftChecks.blocks.length > 0
        ? 'Fix the blocked reply checks before publishing.'
        : unfilledReplySlotsMessage(text)
      : null
  const publishBlockedReasonId = useId()
  const rejectReasonId = useId()
  const rejectReasonRef = useRef<HTMLTextAreaElement>(null)
  /**
   * The Reject trigger, so closing the panel can hand focus back to it.
   *
   * The panel takes focus on open (the effect below), and Cancel closes it by
   * its own click — removing the focused button, which drops focus to
   * `<body>` and loses the reader's place in the thread (WCAG 2.4.3), the rule
   * `inbox-thread.tsx` states for the fold's toggle and follows for the same
   * reason. The trigger is mounted whenever Cancel is: both depend on
   * `canReject`. Confirm rejection does NOT close the panel: a refused reject
   * leaves it open with the reason still typed, and a successful one remounts
   * this whole row as the rejected view, so `ReplyMessage` — above the row's
   * key — is what returns the focus that remount takes.
   */
  const rejectTriggerRef = useRef<HTMLButtonElement>(null)
  const closeRejectPanel = () => {
    setShowRejectInput(false)
    rejectTriggerRef.current?.focus()
  }

  // Revealing a field is not announced on its own, so focus follows the
  // disclosure into the box the manager is now expected to type in.
  useEffect(() => {
    if (showRejectInput) rejectReasonRef.current?.focus()
  }, [showRejectInput])

  if (actions.length === 0) return null

  return (
    <>
      {/* `data-reply-actions`: where `useReplyFocusReturn` returns a focus
          that a check's answer or a reject took away by unmounting the
          focused button. */}
      <div data-reply-actions className="mt-3 flex flex-wrap items-center gap-2">
        <ReplyMessagePublishAction
          approvable={approvable}
          isSaving={isSaving}
          blockedReason={publishBlockedReason}
          blockedReasonId={publishBlockedReasonId}
          onApprove={onApprove}
        />
        <RejectAction
          canReject={canReject}
          isSaving={isSaving}
          expanded={showRejectInput}
          triggerRef={rejectTriggerRef}
          onOpen={() => setShowRejectInput(true)}
        />
        {actions.map((action) => (
          <SimpleAction key={action} action={action} {...props} />
        ))}
      </div>
      <ReplyMessagePublishFeedback
        approvable={approvable}
        blockedReason={publishBlockedReason}
        blockedReasonId={publishBlockedReasonId}
        draftChecks={draftChecks}
      />
      <RejectPanel
        shown={showRejectInput}
        canReject={canReject}
        isSaving={isSaving}
        reason={rejectReason}
        reasonId={rejectReasonId}
        reasonRef={rejectReasonRef}
        onReasonChange={setRejectReason}
        onReject={onReject}
        onCancel={closeRejectPanel}
      />
    </>
  )
}
