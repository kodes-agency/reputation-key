// Navigation guard for unsaved portal edits.
//
// The theme draft lives in portal-detail-page state and the field edits live in
// the settings form; neither is router state, so a breadcrumb click, the Back
// button, or a tab switch (which unmounts the settings panel) used to discard
// them with no warning. useBlocker intercepts the navigation and asks first.
// The repo confirms destructive actions with AlertDialog — window.confirm is
// used nowhere in src/ — so the blocker runs `withResolver` and drives a dialog.

import { useCallback } from 'react'
import { useBlocker } from '@tanstack/react-router'
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

type Props = Readonly<{
  /**
   * Read at navigation time, not render time: the settings form's dirty flag
   * lives in TanStack Form, not in React state here. Pass a stable callback —
   * useBlocker re-registers its history subscription whenever it changes.
   */
  isDirty: () => boolean
}>

export function PortalUnsavedChangesPrompt({ isDirty }: Props) {
  const shouldBlockFn = useCallback(() => isDirty(), [isDirty])
  const blocker = useBlocker({
    shouldBlockFn,
    // Also guard a reload / tab close; evaluated when beforeunload fires.
    enableBeforeUnload: shouldBlockFn,
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
          <AlertDialogTitle>Discard unsaved portal changes?</AlertDialogTitle>
          <AlertDialogDescription>
            This portal has edits that have not been saved. Leaving now discards them.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => blocker.proceed?.()}
          >
            Discard changes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
