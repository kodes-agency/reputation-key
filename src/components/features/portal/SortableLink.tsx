// Portal context — sortable link item with drag handle

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2, Pencil } from 'lucide-react'
import { Button } from '#/components/ui/button'

type LinkItem = {
  id: string
  label: string
  url: string
  sortKey: string
  categoryId: string
}

type Props = Readonly<{
  link: LinkItem
  canEdit: boolean
  onDelete: (linkId: string) => void
  onEdit: (link: LinkItem) => void
}>

export function SortableLink({ link, canEdit, onDelete, onEdit }: Props) {
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
          <Button size="sm" variant="ghost" onClick={() => onDelete(link.id)}>
            <Trash2 className="size-3 text-destructive" />
          </Button>
        </div>
      )}
    </div>
  )
}
