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
// The repo confirms destructive actions with AlertDialog — window.confirm is
// used nowhere in src/ — so the blocker runs `withResolver` and drives a dialog.

import { useCallback } from 'react'
import { useBlocker } from '@tanstack/react-router'
import { usePortalDraftAutosave } from '../portal-editor/portal-draft-autosave-context'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'

export function PortalUnsavedChangesPrompt() {
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

  return (
    <AlertDialog
      open={blocker.status === 'blocked'}
      onOpenChange={(open) => {
        // Escape and the Cancel button both land here. `proceed`/`reset` settle
        // the same promise, so the reset that follows a proceed is a no-op.
        if (!open) blocker.reset?.()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
          <AlertDialogDescription>
            Some changes to this portal have not been saved. Leaving now discards them.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              autosave.discard()
              blocker.proceed?.()
            }}
          >
            Leave and discard
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
