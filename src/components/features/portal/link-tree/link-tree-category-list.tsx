// Category list with DnD context and inline edit forms

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { SortableCategory } from './sortable-category'
import { LinkEditInlineForm } from './link-edit-inline-form'
import { CategoryEditInlineForm } from './category-edit-inline-form'
import { usePermissions } from '#/shared/hooks/usePermissions'
import type { LinkTreeCategory, LinkTreeLink } from './link-tree-types'

type Props = Readonly<{
  categories: readonly LinkTreeCategory[]
  links: readonly LinkTreeLink[]
  deletingCategoryId: string | null
  deletingLinkId: string | null
  editingCategory: string | null
  editingLink: string | null
  onDragEnd: (event: DragEndEvent) => void
  onReorderLinks: (categoryId: string, reordered: readonly LinkTreeLink[]) => void
  onDeleteLink: (linkId: string) => void
  onDeleteCategory: (catId: string) => void
  onEditCategory: (catId: string | null) => void
  onEditLink: (linkId: string | null) => void
  onAddLink: (catId: string | null) => void
  onUpdateCategory: (catId: string, title: string) => void
  onUpdateLink: (linkId: string, label: string, url: string) => void
  isUpdateCategoryPending: boolean
  isUpdateLinkPending: boolean
  updateCategoryError: unknown
  updateLinkError: unknown
}>

export function LinkTreeCategoryList({
  categories,
  links,
  deletingCategoryId,
  deletingLinkId,
  editingCategory,
  editingLink,
  onDragEnd,
  onReorderLinks,
  onDeleteLink,
  onDeleteCategory,
  onEditCategory,
  onEditLink,
  onAddLink,
  onUpdateCategory,
  onUpdateLink,
  isUpdateCategoryPending,
  isUpdateLinkPending,
  updateCategoryError,
  updateLinkError,
}: Props) {
  const { can } = usePermissions()
  const canEdit = can('portal.update')

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={categories.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-4">
          {categories.map((cat) => (
            <div key={cat.id}>
              {editingCategory === cat.id && canEdit ? (
                <CategoryEditInlineForm
                  initialTitle={cat.title}
                  onSubmit={(title) => onUpdateCategory(cat.id, title)}
                  onCancel={() => onEditCategory(null)}
                  isPending={isUpdateCategoryPending}
                  error={updateCategoryError}
                />
              ) : (
                <SortableCategory
                  category={cat}
                  links={links.filter((l) => l.categoryId === cat.id)}
                  isDeletingCategory={deletingCategoryId === cat.id}
                  deletingLinkId={deletingLinkId ?? undefined}
                  onAddLink={(catId) => {
                    onAddLink(catId)
                    onEditLink(null)
                    onEditCategory(null)
                  }}
                  onDeleteLink={onDeleteLink}
                  onDeleteCategory={onDeleteCategory}
                  onEditCategory={(c) => onEditCategory(c.id)}
                  onEditLink={(link) => {
                    onEditLink(link.id)
                    onAddLink(null)
                    onEditCategory(null)
                  }}
                  onReorderLinks={onReorderLinks}
                />
              )}
              {editingLink &&
                links
                  .filter((l) => l.categoryId === cat.id)
                  .map((link) =>
                    link.id === editingLink && canEdit ? (
                      <LinkEditInlineForm
                        key={link.id}
                        initialLabel={link.label}
                        initialUrl={link.url}
                        onSubmit={(label, url) => onUpdateLink(link.id, label, url)}
                        onCancel={() => onEditLink(null)}
                        isPending={isUpdateLinkPending}
                        error={updateLinkError}
                      />
                    ) : null,
                  )}
            </div>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
