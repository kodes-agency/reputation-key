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
  return (
    <div className="space-y-3">
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
            onClick={() => void onRetrySave()}
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

            `aria-describedby` is spread only while there IS a blocked reason.
            `TooltipTrigger asChild` merges props with the child's winning, so
            a child carrying the key as `undefined` would erase the id Radix
            points at the open tooltip, and a keyboard user would hear the
            button without the guarantee. While a reason is shown the button is
            disabled, takes no focus or hover, and the tooltip cannot open —
            so the two descriptions never compete. */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                className="max-md:h-9"
                disabled={!canSubmit || disabled}
                {...(submitBlockedReason !== null
                  ? { 'aria-describedby': submitBlockedReasonId }
                  : {})}
                onClick={() => void onSubmit()}
              >
                {isSubmitting ? 'Submitting…' : 'Submit for approval'}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{PUBLICATION_GUARANTEE}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {submitBlockedReason !== null && (
        <p id={submitBlockedReasonId} role="status" className="text-xs text-destructive">
          {submitBlockedReason}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
