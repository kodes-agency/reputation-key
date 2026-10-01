// Confirmation before a tile is deleted. Controlled, because it is opened from
// the tile's menu rather than from a trigger of its own.

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
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  onDelete: () => void
}>

export function DeleteLinkDialog({ open, onOpenChange, label, onDelete }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this link?</AlertDialogTitle>
          <AlertDialogDescription>
            “{label}” and its texts in every language are removed from the draft. It stays
            on the live page until you publish.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onDelete}
          >
            Delete link
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
