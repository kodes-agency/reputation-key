// Inbox thread — the action row under the property's reply message.
//
// Split out of `reply-message.tsx` so the message itself stays a message: this
// half owns the two pieces of local state a reply message must NOT own (a
// revealed reject panel and the half-typed reason in it), the publish fence,
// and the disclosure relationship between a trigger here and an editor that
// mounts in a different subtree at the foot of the pane's scroller.

import { useEffect, useId, useRef, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import { unfilledReplySlotsMessage } from '#/contexts/review/application/public-api'
import type { ReplyMessageAction } from './reply-message-view'
import type { ReactNode } from 'react'

/**
 * Row 20's control height, on the one region whose controls are the reply's.
 *
 * `size="sm"` is 32 px — the density the desktop pane wants. `max-md:h-9`
 * raises it to 36 below `md` only, the same breakpoint and spelling as the
 * composer's footer (`reply-composer-footer.tsx`) and the case toolbar's status
 * control, so the whole pane switches density on one line. v1's row 15 raised
 * these to 44 (`max-md:h-11`); row 20 lowered every pane control to 36, because
 * WCAG 2.5.8 AA asks for 24 px and 44 is what made the phone pane a block of
 * large buttons (plan finding 6).
 *
 * Measured in Chromium against Storybook dev at 390 and 320
 * (`inbox-mobile-390--thread-reply-*`): Confirm & Publish, Reject, Confirm
 * Reject, Cancel and Edit reply were 44 px tall before the sweep and are 36
 * after it; Edit & resubmit and Try publishing again, measured after only, are
 * 36. At 768 px the variant stops matching and the desktop pane is unchanged.
 *
 * NOT applied to the confirmation dialog's pair: `AlertDialogCancel` and
 * `AlertDialogAction` are default-size buttons, already 36 px, so the constant
 * would only restate the primitive (see the footer below).
 */
const TOUCH = 'max-md:h-9'

export type ReplyMessageActionsProps = Readonly<{
  actions: readonly ReplyMessageAction[]
  /** The SERVER copy of the reply — the same text the publish fence reads. */
  text: string
  isSaving: boolean
  /**
   * Whether the pane is currently showing the published reply's editor. This is
   * the pane's `editTarget`, not a flag either surface owns: the editor mounts
   * at the foot of the scroller, in a different subtree from the trigger below
   * that opens it, so nothing local to this row can see it.
   */
  isEditing: boolean
  onApprove: () => Promise<unknown>
  onReject: (reason?: string) => Promise<unknown>
  onCheck: () => Promise<unknown>
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
          className={TOUCH}
          disabled={isSaving}
          onClick={() => void onCheck().catch(() => undefined)}
        >
          {isSaving ? 'Checking Google…' : 'Check Google again'}
        </Button>
      )
    case 'retry':
      return (
        <Button
          size="sm"
          className={TOUCH}
          disabled={isSaving}
          onClick={() => void onRetry().catch(() => undefined)}
        >
          {isSaving ? 'Starting…' : 'Try publishing again'}
        </Button>
      )
    case 'editPublished':
      return (
        <Button
          size="sm"
          className={TOUCH}
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
          className={TOUCH}
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
  const { actions, text, isSaving, onApprove, onReject } = props
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const canApprove = actions.includes('approve')
  const canReject = actions.includes('reject')
  // The fence reads the reply as the SERVER holds it, not any local text: this
  // message never owns an editor, and `approveReply` re-runs the same check.
  const publishBlockedReason = canApprove ? unfilledReplySlotsMessage(text) : null
  const publishBlockedReasonId = useId()
  const rejectReasonId = useId()
  const rejectReasonRef = useRef<HTMLTextAreaElement>(null)

  // Revealing a field is not announced on its own, so focus follows the
  // disclosure into the box the manager is now expected to type in.
  useEffect(() => {
    if (showRejectInput) rejectReasonRef.current?.focus()
  }, [showRejectInput])

  if (actions.length === 0) return null

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canApprove && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                // A natively disabled button leaves the tab order and takes its
                // description with it, so the one sentence that says why
                // publishing is blocked can never be reached. Blocked stays
                // focusable and refuses the click; `isSaving` keeps the native
                // attribute, because it has nothing to explain.
                disabled={isSaving}
                aria-disabled={publishBlockedReason !== null}
                // The look the native attribute used to carry, kept on the one
                // state that no longer sets it.
                className={`aria-disabled:opacity-50 ${TOUCH}`}
                aria-describedby={
                  publishBlockedReason !== null ? publishBlockedReasonId : undefined
                }
                // `AlertDialogTrigger` composes this ahead of its own handler
                // and honours a prevented default, so the dialog stays shut.
                onClick={(event) => {
                  if (publishBlockedReason !== null) event.preventDefault()
                }}
              >
                Confirm &amp; Publish
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm and publish this reply?</AlertDialogTitle>
                <AlertDialogDescription>
                  This records your confirmation and starts publishing the exact reply
                  shown here to Google. RepKey keeps it pending until Google confirms that
                  it is live.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                {/* No class. The primitive's own `size="default"` is 36 px,
                    which is row 20's control height below `md`. v1's row 15
                    raised this pair to 44 at the call site (the shared
                    primitives stay untouched); row 20 lowers it back to the
                    primitive's own 36, so the override is deleted rather than
                    re-spelled. Measured in Chromium against Storybook dev at
                    390 and 320: 44 px tall before, 36 after. */}
                <AlertDialogCancel>Keep reviewing</AlertDialogCancel>
                <AlertDialogAction
                  disabled={isSaving || publishBlockedReason !== null}
                  onClick={() => void onApprove().catch(() => undefined)}
                >
                  {isSaving ? 'Confirming…' : 'Confirm & Publish'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {canReject && (
          <Button
            size="sm"
            className={TOUCH}
            variant="destructive"
            disabled={isSaving}
            aria-expanded={showRejectInput}
            onClick={() => setShowRejectInput(true)}
          >
            Reject
          </Button>
        )}
        {actions.map((action) => (
          <SimpleAction key={action} action={action} {...props} />
        ))}
      </div>

      {publishBlockedReason !== null && (
        <p id={publishBlockedReasonId} className="mt-2 text-xs text-destructive">
          {publishBlockedReason}
        </p>
      )}

      {showRejectInput && canReject && (
        <div className="mt-3 space-y-2">
          <Label htmlFor={rejectReasonId} className="text-xs font-medium">
            Reason for rejection (optional)
          </Label>
          <Textarea
            id={rejectReasonId}
            ref={rejectReasonRef}
            placeholder="Reason for rejection (optional)..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={2}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className={TOUCH}
              variant="destructive"
              disabled={isSaving}
              // `Action` is `mutateAsync`, so an unguarded call turns a server
              // error into an unhandled rejection — the toast already reports it.
              onClick={() =>
                void onReject(rejectReason || undefined).catch(() => undefined)
              }
            >
              Confirm Reject
            </Button>
            <Button
              size="sm"
              className={TOUCH}
              variant="ghost"
              onClick={() => setShowRejectInput(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
