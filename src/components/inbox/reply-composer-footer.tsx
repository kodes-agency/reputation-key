import { useId } from 'react'
import { Button } from '#/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import type { ReplyAutosaveStatus } from './use-reply-autosave'

type Props = Readonly<{
  /** Read for `Retry save` only; the status itself is printed in the dock's head. */
  status: ReplyAutosaveStatus
  error: string | null
  canSubmit: boolean
  submitBlockedReason: string | null
  disabled: boolean
  isSubmitting: boolean
  onRetrySave: () => Promise<void>
  onSubmit: () => Promise<void>
  onDelete?: () => Promise<unknown>
}>

/**
 * The publication guarantee, where it matters (plan v2.1 row 14).
 *
 * It used to ride on the save-state line under the box, in every autosave
 * status (`Draft saved · publishes only after approval`). Row 14 deletes that
 * line and row 16 moves the status itself up into the dock's head
 * (`composer-mode-row.tsx`), so the sentence goes to the two places a manager
 * meets it at the moment it is true of what they are about to do: here, on the
 * control that submits, and in the submit's success toast
 * (`use-reply-actions.ts`), which is the half a phone — which never shows a
 * tooltip — reads.
 */
const PUBLICATION_GUARANTEE = 'Nothing publishes until a manager approves it'

export function ReplyComposerFooter({
  status,
  error,
  canSubmit,
  submitBlockedReason,
  disabled,
  isSubmitting,
  onRetrySave,
  onSubmit,
  onDelete,
}: Props) {
  const submitBlockedReasonId = useId()
  const errorId = useId()
  const guaranteeId = useId()
  return (
    // `flex flex-col gap-3`, not `space-y-3`. Tailwind compiles `space-y-*` to
    // a margin on `:not(:last-child)`, which is a STRUCTURAL selector: the
    // always-mounted reason below is still the last child when it is empty and
    // `sr-only`-positioned, so `space-y-3` gave the action row 12 px of margin
    // in the ordinary submittable state. A flex `gap` ignores an absolutely
    // positioned child outright, which is what the two sibling regions
    // (`inbox-thread.tsx`, `reply-suggestion-controls.tsx`) already rely on.
    <div className="flex flex-col gap-3">
      {/* `justify-end`: the save state that used to hold the left of this row
          with `mr-auto` is in the dock's head now, and the actions keep their
          place against the trailing edge rather than sliding left into the
          space it left. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {/* 36 px on mobile (row 20). v1's row 15 raised these three to 44 —
            they are the reply half of the pinned region, including its ONLY
            primary — and row 20 lowered every such control to 36 in the PR
            that touches its file, because WCAG 2.5.8 AA asks for 24 px and 44
            was what inflated the phone dock. The spelling matches the mode
            segment (`composer-mode-row.tsx`) and the live-edit pair
            (`reply-editor-views.tsx`); `h-9` rather than `min-h-9` because
            none of the three wraps. `max-md:` only: the desktop pane is dense
            on purpose. */}
        {status === 'error' && (
          <Button
            size="sm"
            variant="ghost"
            className="max-md:h-9"
            disabled={disabled}
            // Settled only so a retry that fails again is not an unhandled
            // rejection: the coordinator has already put the failure back on
            // the error line below before it rejects.
            onClick={() => void onRetrySave().catch(() => undefined)}
          >
            Retry save
          </Button>
        )}
        {onDelete && (
          <Button
            size="sm"
            variant="ghost"
            className="max-md:h-9"
            disabled={disabled}
            // Settled only so a refused delete is not an unhandled rejection:
            // the delete mutation's `errorMessage` (use-reply-actions.ts)
            // toasts the server's sentence.
            onClick={() => void onDelete().catch(() => undefined)}
          >
            Delete draft
          </Button>
        )}
        {/* Its own provider: nothing above this footer is guaranteed to mount
            one (the app shell's lives in `ui/sidebar.tsx`, and no story or
            standalone render has it), and Radix's `Tooltip` throws without.

            BLOCKED-WITH-A-REASON IS `aria-disabled`, NOT `disabled` — the rule
            `reply-message-actions.tsx` and `reply-editor-views.tsx` already
            follow, and split the same way they split it. A natively disabled
            button leaves the tab order and takes its `aria-describedby` with
            it, so the one sentence that says why this reply cannot be submitted
            was unreachable precisely when it was on screen.

            The native attribute survives for every blocker that has NOTHING to
            explain — an in-flight write or AI request, an empty or over-long
            box, a failed autosave. Those leave no
            `submitBlockedReason`, so making them `aria-disabled` would only
            produce a focusable control that announces itself unavailable and
            says nothing about why. `canSubmit` has more clauses than
            `submitBlockedReason` has sentences, and this is where that gap is
            paid.

            While a reason IS shown the button stays focusable, so Radix opens
            the tooltip too and both descriptions are live at once — which is
            why `aria-describedby` is spelled out below rather than left to
            either party. */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                className="max-md:h-9 aria-disabled:opacity-50"
                disabled={disabled || (!canSubmit && submitBlockedReason === null)}
                aria-disabled={submitBlockedReason !== null}
                // Both descriptions, spelled here rather than left to Radix.
                // `TooltipTrigger asChild` merges through `Slot`, where the
                // CHILD wins a non-handler prop — so a bare
                // `aria-describedby={submitBlockedReasonId}` overwrote the id
                // Radix points at the open tooltip, and the publication
                // guarantee became unreachable in exactly the state that also
                // shows a blocking reason. An id whose element is not mounted
                // is ignored, so listing both is safe while the tooltip is shut.
                aria-describedby={[
                  submitBlockedReason !== null ? submitBlockedReasonId : null,
                  error ? errorId : null,
                  guaranteeId,
                ]
                  .filter(Boolean)
                  .join(' ')}
                // The early return is the guard: there is no form and no
                // `AlertDialogTrigger` here, so nothing downstream reads a
                // prevented default (unlike `reply-message-actions.tsx`, where
                // the trigger honours one).
                onClick={() => {
                  if (!canSubmit) return
                  void onSubmit()
                }}
              >
                {isSubmitting ? 'Submitting…' : 'Submit for approval'}
              </Button>
            </TooltipTrigger>
            <TooltipContent id={guaranteeId}>{PUBLICATION_GUARANTEE}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {/* One region, always mounted, holding its message conditionally.
          A live region has to be in the document — and in the accessibility
          tree — BEFORE its text changes, or the first message is announced by
          nobody. `empty:sr-only` is what makes that free: with no reason the
          element is truly empty, and `sr-only` takes it out of flow rather than
          out of the tree, the way `hidden` would. One copy of the sentence, so
          `aria-describedby` and the announcement never disagree and no query
          matches it twice. The `id` persists for the button to point at. */}
      <p
        id={submitBlockedReasonId}
        role="status"
        className="text-xs text-destructive empty:sr-only"
      >
        {submitBlockedReason}
      </p>
      {/* The save-failure line, on the same always-mounted pattern as the
          reason above and for the same reason. It prints autosave's own
          `error` and nothing else — the save `submit()` runs before submitting
          (`submitAfterSave`) fails through the same coordinator, so that
          failure lands here in autosave's words too. A failed save leaves
          autosave in `error`, which disables Submit natively, so focus has
          usually fallen off it and only a live region can tell a
          screen-reader user that nothing was sent. A refused SUBMIT is not
          printed here: the submit mutation's `errorMessage` toasts the
          server's own sentence (`use-reply-actions.ts`), and a line repeating
          it would report one refusal twice. Polite, not an alert: the dock's
          head already announces an autosave failure, and an assertive region
          would repeat and interrupt. Every new attempt to save — a keystroke,
          `Retry save`, a flush — first emits a status with no error, which
          empties the line, so a second failure is a fresh change and is
          announced again. Submit points `aria-describedby` at it while it has
          something to say. */}
      <p id={errorId} role="status" className="text-xs text-destructive empty:sr-only">
        {error}
      </p>
    </div>
  )
}
