// Delete property confirmation dialog — irreversible action with AlertDialog pattern
import { deleteProperty } from '#/contexts/property/server/properties'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
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

type Props = Readonly<{
  propertyId: string
  propertyName: string
}>

export function DeletePropertyDialog({ propertyId, propertyName }: Props) {
  const deleteAction = useMutationAction(deleteProperty, {
    successMessage: `"${propertyName}" deleted`,
    invalidateRoutes: ['/_authenticated'],
  })

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
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
