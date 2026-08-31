// Recoverable Portal archive/restore control. Archive preserves the Portal's
// address, snapshots, metrics, assignments, and saved settings. Restore is
// intentionally non-public: it always returns to Disabled and requires a later,
// deliberate publication after the manager re-checks the retained configuration.

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
import { Archive, RotateCcw } from 'lucide-react'
import type { Action } from '#/components/hooks/use-action'

interface PortalArchiveButtonProps {
  portalId: string
  portalName: string
  publicationState: 'draft' | 'published' | 'disabled' | 'archived'
  archiveMutation: Action<{
    data: { portalId: string; publicationState: 'archived' }
  }>
  restoreMutation: Action<{
    data: { portalId: string; publicationState: 'disabled' }
  }>
}

export function PortalArchiveButton({
  portalId,
  portalName,
  publicationState,
  archiveMutation,
  restoreMutation,
}: PortalArchiveButtonProps) {
  const restoring = publicationState === 'archived'
  const mutation = restoring ? restoreMutation : archiveMutation
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="min-h-11 sm:min-h-8"
          disabled={mutation.isPending}
        >
          {restoring ? (
            <RotateCcw className="size-3.5" />
          ) : (
            <Archive className="size-3.5" />
          )}
          {restoring ? 'Restore' : 'Archive'}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {restoring ? `Restore ${portalName}?` : `Archive ${portalName}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {restoring
              ? 'The Portal will return as Disabled. Its saved settings remain available, but guests will not see it until you review and publish it again.'
              : 'The Portal will become read-only and unavailable to guests. Its public address, saved settings, publication history, metrics, goals, and manager assignments are retained so it can be restored later.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (restoring) {
                void restoreMutation({
                  data: { portalId, publicationState: 'disabled' },
                }).catch(() => undefined)
              } else {
                void archiveMutation({
                  data: { portalId, publicationState: 'archived' },
                }).catch(() => undefined)
              }
            }}
            disabled={mutation.isPending}
          >
            {mutation.isPending
              ? restoring
                ? 'Restoring…'
                : 'Archiving…'
              : restoring
                ? 'Restore as Disabled'
                : 'Archive Portal'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
