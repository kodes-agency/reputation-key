// Portal context — sortable link item with drag handle

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2, Pencil } from 'lucide-react'
import { Button } from '#/components/ui/button'
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
import { usePermissions } from '#/shared/hooks/usePermissions'
import type { LinkTreeLink } from './link-tree.types'

type Props = Readonly<{
  link: LinkTreeLink
  isDeleting?: boolean
  onDelete: (linkId: string) => void
  onEdit: (link: LinkTreeLink) => void
}>

export function SortableLink({ link, isDeleting, onDelete, onEdit }: Props) {
  const { can } = usePermissions()
  const canEdit = can('portal.update')
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: link.id,
    disabled: !canEdit,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center justify-between rounded-md border px-3 py-2"
    >
      <div className="flex items-center gap-2">
        {canEdit && (
          <button {...attributes} {...listeners} className="cursor-grab">
            <GripVertical className="size-4 text-muted-foreground" />
          </button>
        )}
        <span className="text-sm">{link.label}</span>
        <span className="text-xs text-muted-foreground">{link.url}</span>
      </div>
      {canEdit && (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => onEdit(link)}>
            <Pencil className="size-3 text-muted-foreground" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" disabled={isDeleting}>
                <Trash2 className="size-3 text-muted-foreground" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Link</AlertDialogTitle>
                <AlertDialogDescription>
                  Delete &quot;{link.label}&quot;? This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => onDelete(link.id)}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  )
}
