// Portal delete button with confirmation dialog
// Receives wrapped delete action (from route) per QRY-04/05 + routes/CONTEXT.md.
// Component does not call useActionMutation; route owns the mutation.

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

interface PortalDeleteButtonProps {
  portalId: string
  portalName: string
  deleteMutation: Action<{ data: { portalId: string } }>
}

export function PortalDeleteButton({
  portalId,
  portalName,
  deleteMutation,
}: PortalDeleteButtonProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="text-destructive hover:text-destructive"
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
            This portal and all its links will be permanently removed. This action cannot
            be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => deleteMutation({ data: { portalId } })}
            disabled={deleteMutation.isPending}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete portal'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
