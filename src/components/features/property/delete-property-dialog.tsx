// Delete property confirmation dialog — irreversible action with AlertDialog pattern
// Receives pre-wrapped mutation action as prop per src/routes/CONTEXT.md convention.

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

type Props = Readonly<{
  propertyId: string
  propertyName: string
  deleteAction: Action<
    { data: { propertyId: string } },
    { deleted: boolean; propertyId: string }
  >
}>

export function DeletePropertyDialog({ propertyId, propertyName, deleteAction }: Props) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete ${propertyName}`}
          className="size-8 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete property</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete &quot;{propertyName}&quot;? This will remove
            all associated reviews, inbox items, and team assignments. This action cannot
            be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => deleteAction({ data: { propertyId } })}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
