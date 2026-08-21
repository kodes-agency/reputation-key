// Portal delete button with confirmation dialog.
//
// This used to be called "Archive" and the dialog promised the configuration was
// retained. It is not: `softDeletePortal` sets `deleted_at` and never touches
// `publicationState`, and `listPortals` filters `deleted_at IS NULL`, so the
// portal disappears with no archived view and no restore action anywhere in the
// product. The row survives in the database for audit, but from the manager's
// side the action is irreversible — and a portal's printed QR mapping dies with
// it. The label and copy now say exactly that. Rename this back to "Archive"
// only together with an archived filter and a restore action.

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
import { Trash2 } from 'lucide-react'
import type { Action } from '#/components/hooks/use-action'

interface PortalArchiveButtonProps {
  portalId: string
  portalName: string
  deleteMutation: Action<{ data: { portalId: string } }>
}

export function PortalArchiveButton({
  portalId,
  portalName,
  deleteMutation,
}: PortalArchiveButtonProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="min-h-11 text-destructive hover:text-destructive sm:min-h-8"
          disabled={deleteMutation.isPending}
        >
          <Trash2 className="size-3.5" />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {portalName}?</AlertDialogTitle>
          <AlertDialogDescription>
            This cannot be undone from here. The portal, its links and its public address
            are removed, so any printed QR code pointing at it stops working. To take a
            portal offline temporarily, set its status to Disabled instead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              void deleteMutation({ data: { portalId } }).catch(() => undefined)
            }}
            disabled={deleteMutation.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteMutation.isPending ? 'Deleting…' : 'Delete portal'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
