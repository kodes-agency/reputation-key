// Portal context — sortable category with links

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { Plus, GripVertical, Pencil } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { SortableLink } from './sortable-link'
import { DeleteCategoryDialog } from './delete-category-dialog'
import { usePermissions } from '#/shared/hooks/usePermissions'
import type { LinkTreeCategory, LinkTreeLink } from './link-tree-types'

type Props = Readonly<{
  category: LinkTreeCategory
  links: readonly LinkTreeLink[]
  isDeletingCategory?: boolean
  deletingLinkId?: string
  onAddLink: (catId: string) => void
  onDeleteLink: (linkId: string) => void
  onDeleteCategory: (catId: string) => void
  onEditCategory: (cat: LinkTreeCategory) => void
  onEditLink: (link: LinkTreeLink) => void
  onReorderLinks: (catId: string, reordered: readonly LinkTreeLink[]) => void
}>

export function SortableCategory({
  category,
  links,
  isDeletingCategory,
  deletingLinkId,
  onAddLink,
  onDeleteLink,
  onDeleteCategory,
  onEditCategory,
  onEditLink,
  onReorderLinks,
}: Props) {
  const { can } = usePermissions()
  const canEdit = can('portal.update')
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: category.id,
    disabled: !canEdit,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const linkSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const handleLinkDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = links.findIndex((l) => l.id === active.id)
    const newIndex = links.findIndex((l) => l.id === over.id)
    const reordered = arrayMove([...links], oldIndex, newIndex)
    onReorderLinks(category.id, reordered)
  }

  return (
    <div ref={setNodeRef} style={style} className="rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {canEdit && (
            <button {...attributes} {...listeners} className="cursor-grab">
              <GripVertical className="size-4 text-muted-foreground" />
            </button>
          )}
          <h4 className="font-semibold">{category.title}</h4>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <>
              <Button size="sm" variant="ghost" onClick={() => onEditCategory(category)}>
                <Pencil className="size-3 text-muted-foreground" />
              </Button>
              <Button size="sm" variant="outline" onClick={() => onAddLink(category.id)}>
                <Plus className="size-3" />
                Add Link
              </Button>
              <DeleteCategoryDialog
                categoryTitle={category.title}
                isDeleting={!!isDeletingCategory}
                onDelete={() => onDeleteCategory(category.id)}
              />
            </>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <DndContext
          sensors={linkSensors}
          collisionDetection={closestCenter}
          onDragEnd={handleLinkDragEnd}
        >
          <SortableContext
            items={links.map((l) => l.id)}
            strategy={verticalListSortingStrategy}
          >
            {links.map((link) => (
              <SortableLink
                key={link.id}
                link={link}
                isDeleting={deletingLinkId === link.id}
                onDelete={onDeleteLink}
                onEdit={onEditLink}
              />
            ))}
          </SortableContext>
        </DndContext>
        {links.length === 0 && (
          <p className="py-2 text-center text-sm text-muted-foreground">
            No links yet. Add your first link.
          </p>
        )}
      </div>
    </div>
  )
}
