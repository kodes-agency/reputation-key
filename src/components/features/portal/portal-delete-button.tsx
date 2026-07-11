// Portal delete button with confirmation dialog
// Receives deletePortal server fn as prop per src/components/CONTEXT.md.

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
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { portalKeys } from '#/shared/queries/query-keys'
import type { deletePortal } from '#/contexts/portal/server/portals'

interface PortalDeleteButtonProps {
  portalId: string
  portalName: string
  deletePortalFn: typeof deletePortal
}

export function PortalDeleteButton({
  portalId,
  portalName,
  deletePortalFn,
}: PortalDeleteButtonProps) {
  const deleteMutation = useActionMutation(deletePortalFn, {
    successMessage: 'Portal deleted',
    invalidateKeys: [portalKeys.all],
  })

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
