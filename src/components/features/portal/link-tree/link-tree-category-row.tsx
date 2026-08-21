// Portal context — one category row: the sortable category plus the inline
// forms that can open in its place (title) or under it (link).
//
// Split out of link-tree-category-list.tsx, which now only owns the drag
// context and the loop. The row takes the tree's flat prop surface as three
// cohesive slices so that neither file threads a dozen singles through JSX.

import { SortableCategory } from './sortable-category'
import { LinkEditInlineForm } from './link-edit-inline-form'
import { CategoryEditInlineForm } from './category-edit-inline-form'
import { categoryRowSlots } from './link-tree-state-rules'
import type { LinkTreeCategory, LinkTreeLink } from './link-tree-types'

/** Which row is mid-edit, plus the openers and cancels for each slot. */
export type CategoryEditSlots = Readonly<{
  canEdit: boolean
  editingCategory: string | null
  editingLink: string | null
  onOpenAddLink: (catId: string) => void
  onOpenEditCategory: (cat: LinkTreeCategory) => void
  onOpenEditLink: (link: LinkTreeLink) => void
  onCloseCategory: () => void
  onCloseLink: () => void
}>

/**
 * The save side of both inline forms. The submit handlers are
 * promise-returning: the forms attach the `.catch` that keeps a failed save
 * from escaping as an unhandledrejection.
 */
export type CategorySaveState = Readonly<{
  onUpdateCategory: (catId: string, title: string) => Promise<void> | void
  onUpdateLink: (linkId: string, label: string, url: string) => Promise<void> | void
  isUpdateCategoryPending: boolean
  isUpdateLinkPending: boolean
  updateCategoryError: unknown
  updateLinkError: unknown
}>

/** Deletion handlers plus the ids currently in flight. */
export type CategoryRemovalState = Readonly<{
  deletingCategoryId: string | null
  deletingLinkId: string | null
  onDeleteLink: (linkId: string) => void
  onDeleteCategory: (catId: string) => void
}>

/** Everything a row needs that is identical for every row in the tree. */
export type CategoryRowSlices = Readonly<{
  links: readonly LinkTreeLink[]
  slots: CategoryEditSlots
  saves: CategorySaveState
  removals: CategoryRemovalState
  onReorderLinks: (catId: string, reordered: readonly LinkTreeLink[]) => void
}>

type Props = CategoryRowSlices & Readonly<{ category: LinkTreeCategory }>

export function LinkTreeCategoryRow({
  category,
  links,
  slots,
  saves,
  removals,
  onReorderLinks,
}: Props) {
  const {
    links: ownLinks,
    isEditingTitle,
    linkBeingEdited,
  } = categoryRowSlots(category, links, slots)

  return (
    <div>
      {isEditingTitle ? (
        <CategoryEditInlineForm
          initialTitle={category.title}
          onSubmit={(title) => saves.onUpdateCategory(category.id, title)}
          onCancel={slots.onCloseCategory}
          isPending={saves.isUpdateCategoryPending}
          error={saves.updateCategoryError}
        />
      ) : (
        <SortableCategory
          category={category}
          links={ownLinks}
          isDeletingCategory={removals.deletingCategoryId === category.id}
          deletingLinkId={removals.deletingLinkId ?? undefined}
          onAddLink={slots.onOpenAddLink}
          onDeleteLink={removals.onDeleteLink}
          onDeleteCategory={removals.onDeleteCategory}
          onEditCategory={slots.onOpenEditCategory}
          onEditLink={slots.onOpenEditLink}
          onReorderLinks={onReorderLinks}
        />
      )}
      {/* Keyed so switching which link is being edited REMOUNTS the form —
          it seeds its inputs from initialLabel/initialUrl once. */}
      {linkBeingEdited ? (
        <LinkEditInlineForm
          key={linkBeingEdited.id}
          initialLabel={linkBeingEdited.label}
          initialUrl={linkBeingEdited.url}
          onSubmit={(label, url) => saves.onUpdateLink(linkBeingEdited.id, label, url)}
          onCancel={slots.onCloseLink}
          isPending={saves.isUpdateLinkPending}
          error={saves.updateLinkError}
        />
      ) : null}
    </div>
  )
}
