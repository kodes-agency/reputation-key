// Navigation guard for the portal editor.
//
// Edits save themselves, so leaving is safe in the usual case and this guard
// stays quiet. It does two things. Before any in-app navigation it writes
// whatever is still waiting out its debounce (`flush`) — the section forms
// unmount on a section switch, and a form remounted from a cache the write has
// not reached yet would show stale text. Then it asks only if something could
// not be saved: a write that failed, a form that refused its values, or a
// property-wide form with edits and no Save yet. A reload or tab close is
// guarded whenever anything at all is unsaved, because a write in flight does
// not survive it.
//
// In the portal editor the question names what would be lost ("Not saved: this
// portal's welcome line in Bulgarian"). When every cause is a write that
// failed, trying again may save it all, so that is the main action and leaving
// without it the other; a refused value or an explicit Save cannot be retried
// from here, so those ask only whether to leave. A page that passes its own
// `description` (the Property look) keeps its words and its two choices.
// The repo confirms destructive actions with ConfirmationDialog — window.confirm
// is used nowhere in src/ — so the blocker runs `withResolver` and drives a dialog.

import { useCallback, useState } from 'react'
import { useBlocker } from '@tanstack/react-router'
import { usePortalDraftAutosave } from '../portal-editor/portal-draft-autosave-context'
import { Button } from '#/components/ui/button'
import { ConfirmationDialog } from '#/components/ui/confirmation-dialog'
import { describeUnsaved, type UnsavedSummary } from './portal-unsaved-parts'

const PORTAL_CHANGES_COPY =
  'Some changes to this portal have not been saved. If you go on, they are discarded.'

/** What a retry that did not save everything rejects with, for the dialog's banner. */
class StillNotSavedError extends Error {}

/** `description` names what would be lost; the portal editor's own wording, names and retry when omitted. */
export function PortalUnsavedChangesPrompt({
  description,
}: Readonly<{ description?: string }>) {
  const autosave = usePortalDraftAutosave()
  const shouldBlockFn = useCallback(async () => {
    await autosave.flush()
    return autosave.needsAttention()
  }, [autosave])
  const warnBeforeUnload = useCallback(() => autosave.hasUnsaved(), [autosave])
  const blocker = useBlocker({
    shouldBlockFn,
    enableBeforeUnload: warnBeforeUnload,
    withResolver: true,
  })
  const open = blocker.status === 'blocked'
  // Read once as the question opens and held while it is open, so a retry that
  // lands does not swap the dialog under the person's click.
  const [asked, setAsked] = useState<UnsavedSummary | null>(null)
  if (open && asked === null) setAsked(describeUnsaved(autosave.attention()))
  if (!open && asked !== null) setAsked(null)
  const named = asked ?? describeUnsaved(autosave.attention())
  // A page with its own words names what it holds itself.
  const summary: UnsavedSummary =
    description === undefined ? named : { line: null, retryable: false }
  const close = (next: boolean) => {
    // Escape, Cancel and the confirm itself all land here. `proceed`/`reset`
    // settle the same promise, so the reset that follows a proceed is a no-op.
    if (!next) blocker.reset?.()
  }
  const leave = () => {
    autosave.discard()
    blocker.proceed?.()
  }

  if (summary.retryable) {
    return (
      <ConfirmationDialog
        open={open}
        onOpenChange={close}
        title="Save before you leave?"
        description={[summary.line, 'Try saving again, or leave without it.']
          .filter(Boolean)
          .join(' ')}
        cancelLabel="Keep editing"
        confirmLabel="Try saving again"
        pendingLabel="Saving…"
        onConfirm={async () => {
          await autosave.retry()
          if (autosave.needsAttention()) {
            throw autosave.getState().error ?? new StillNotSavedError('Not saved')
          }
          blocker.proceed?.()
        }}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={leave}
        >
          Leave and discard
        </Button>
      </ConfirmationDialog>
    )
  }

  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={close}
      tone="destructive"
      title="Leave without saving?"
      description={[summary.line, description ?? PORTAL_CHANGES_COPY]
        .filter(Boolean)
        .join(' ')}
      cancelLabel="Keep editing"
      confirmLabel="Leave and discard"
      onConfirm={leave}
    />
  )
}
