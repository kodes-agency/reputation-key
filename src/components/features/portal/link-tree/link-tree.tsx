// Server import exception: 8+ mutations (CRUD categories + CRUD links + reorder categories + reorder links)
// Link tree — full CRUD for categories and links with DnD support.
// Extracted from portal-detail-page to separate the link-tree concern.

import { LinkAddInlineForm } from './link-add-inline-form'
import { CategoryAddForm } from './category-add-form'
import { LinkTreeEmptyState } from './link-tree-empty-state'
import { LinkTreeCategoryList } from './link-tree-category-list'
import { useLinkTreeState } from './use-link-tree-state'
import { usePermissions } from '#/shared/hooks/usePermissions'
import type { LinkTreeCategory, LinkTreeLink } from './link-tree-types'

type Props = Readonly<{
  portalId: string
  categories: readonly LinkTreeCategory[]
  links: readonly LinkTreeLink[]
}>

export function LinkTree({
  portalId,
  categories: initialCategories,
  links: initialLinks,
}: Props) {
  const { can } = usePermissions()
  const {
    categories,
    links,
    addingToCategory,
    editingLink,
    editingCategory,
    deletingCategoryId,
    deletingLinkId,
    setAddingToCategory,
    setEditingLink,
    setEditingCategory,
    createCategoryMutation,
    createLinkMutation,
    updateCategoryMutation,
    updateLinkMutation,
    handleAddCategory,
    handleAddLink,
    handleDeleteCategory,
    handleDeleteLink,
    handleUpdateCategory,
    handleUpdateLink,
    handleDragEnd,
    handleReorderLinks,
  } = useLinkTreeState(portalId, initialCategories, initialLinks)

  return (
    <section className="rounded-lg border p-4 space-y-4">
      <h2 className="text-lg font-semibold">Link Tree</h2>

      {can('portal.update') && (
        <CategoryAddForm
          onSubmit={handleAddCategory}
          isPending={createCategoryMutation.isPending}
          error={createCategoryMutation.error}
        />
      )}

      {addingToCategory && can('portal.update') && (
        <LinkAddInlineForm
          onSubmit={(label, url) => handleAddLink(addingToCategory, label, url)}
          onCancel={() => setAddingToCategory(null)}
          isPending={createLinkMutation.isPending}
          error={createLinkMutation.error}
        />
      )}

      <LinkTreeCategoryList
        categories={categories}
        links={links}
        deletingCategoryId={deletingCategoryId}
        deletingLinkId={deletingLinkId}
        editingCategory={editingCategory}
        editingLink={editingLink}
        onDragEnd={handleDragEnd}
        onReorderLinks={handleReorderLinks}
        onDeleteLink={handleDeleteLink}
        onDeleteCategory={handleDeleteCategory}
        onEditCategory={setEditingCategory}
        onEditLink={setEditingLink}
        onAddLink={setAddingToCategory}
        onUpdateCategory={handleUpdateCategory}
        onUpdateLink={handleUpdateLink}
        isUpdateCategoryPending={updateCategoryMutation.isPending}
        isUpdateLinkPending={updateLinkMutation.isPending}
        updateCategoryError={updateCategoryMutation.error}
        updateLinkError={updateLinkMutation.error}
      />

      {categories.length === 0 && <LinkTreeEmptyState />}
    </section>
  )
}
