// Category list — owns the category drag context and the loop; each row (and
// the inline forms that open in it) lives in link-tree-category-row.tsx.

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
import { LinkTreeCategoryRow, type CategoryRowSlices } from './link-tree-category-row'
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
  // Promise-returning: the inline forms attach the .catch that keeps a failed
  // save from escaping as an unhandledrejection.
  onUpdateCategory: (catId: string, title: string) => Promise<void> | void
  onUpdateLink: (linkId: string, label: string, url: string) => Promise<void> | void
  isUpdateCategoryPending: boolean
  isUpdateLinkPending: boolean
  updateCategoryError: unknown
  updateLinkError: unknown
}>

/**
 * Regroups the flat public props into the row's cohesive slices.
 *
 * The public surface stays flat because LinkTree and the Storybook plays drive
 * it; this is the single seam that adapts it, and it is hoisted out of the loop
 * so the slot openers are built once per render rather than once per category.
 */
function rowSlices(props: Props, canEdit: boolean): CategoryRowSlices {
  const { onAddLink, onEditLink, onEditCategory } = props

  return {
    links: props.links,
    onReorderLinks: props.onReorderLinks,
    slots: {
      canEdit,
      editingCategory: props.editingCategory,
      editingLink: props.editingLink,
      // Opening the add-link form closes the link editor and vice versa, so the
      // two never sit open together. Opening the CATEGORY editor deliberately
      // leaves the add-link form alone — long-standing behaviour, preserved
      // verbatim here rather than quietly normalised.
      onOpenAddLink: (catId) => {
        onAddLink(catId)
        onEditLink(null)
        onEditCategory(null)
      },
      onOpenEditLink: (link) => {
        onEditLink(link.id)
        onAddLink(null)
        onEditCategory(null)
      },
      onOpenEditCategory: (cat) => onEditCategory(cat.id),
      onCloseCategory: () => onEditCategory(null),
      onCloseLink: () => onEditLink(null),
    },
    saves: {
      onUpdateCategory: props.onUpdateCategory,
      onUpdateLink: props.onUpdateLink,
      isUpdateCategoryPending: props.isUpdateCategoryPending,
      isUpdateLinkPending: props.isUpdateLinkPending,
      updateCategoryError: props.updateCategoryError,
      updateLinkError: props.updateLinkError,
    },
    removals: {
      deletingCategoryId: props.deletingCategoryId,
      deletingLinkId: props.deletingLinkId,
      onDeleteLink: props.onDeleteLink,
      onDeleteCategory: props.onDeleteCategory,
    },
  }
}

export function LinkTreeCategoryList(props: Props) {
  const { can } = usePermissions()
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const slices = rowSlices(props, can('portal.update'))

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={props.onDragEnd}
    >
      <SortableContext
        items={props.categories.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-4">
          {props.categories.map((cat) => (
            <LinkTreeCategoryRow key={cat.id} category={cat} {...slices} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
