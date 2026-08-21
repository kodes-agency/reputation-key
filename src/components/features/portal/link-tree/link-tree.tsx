// Server import exception: 8+ mutations (CRUD categories + CRUD links + reorder categories + reorder links)
// Link tree — full CRUD for categories and links with DnD support.
// Extracted from portal-detail-page to separate the link-tree concern.

import { useRef } from 'react'
import { LinkAddInlineForm } from './link-add-inline-form'
import { CategoryAddForm } from './category-add-form'
import { LinkTreeEmptyState } from './link-tree-empty-state'
import { LinkTreeCategoryList } from './link-tree-category-list'
import { useLinkTreeState } from './use-link-tree-state'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
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
  const categoryInputRef = useRef<HTMLInputElement>(null)
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
    isCreateCategoryPending,
    isCreateLinkPending,
    isUpdateCategoryPending,
    isUpdateLinkPending,
    createCategoryError,
    createLinkError,
    updateCategoryError,
    updateLinkError,
    actionError,
    handleAddCategory,
    handleAddLink,
    handleDeleteCategory,
    handleDeleteLink,
    handleUpdateCategory,
    handleUpdateLink,
    handleDragEnd,
    handleReorderLinks,
  } = useLinkTreeState(portalId, initialCategories, initialLinks)
  const canEdit = can('portal.update')

  return (
    <section className="rounded-lg border p-4 space-y-4">
      <h2 className="text-lg font-semibold">Link Tree</h2>

      {/* Deletes and drag-reorders have no inline form to report into; without
          this banner a failure was indistinguishable from success. */}
      <FormErrorBanner error={actionError} />

      {categories.length === 0 && (
        <LinkTreeEmptyState
          onAddCategory={canEdit ? () => categoryInputRef.current?.focus() : undefined}
        />
      )}

      {canEdit && (
        <CategoryAddForm
          onSubmit={handleAddCategory}
          isPending={isCreateCategoryPending}
          error={createCategoryError}
          inputRef={categoryInputRef}
        />
      )}

      {addingToCategory && canEdit && (
        <LinkAddInlineForm
          onSubmit={(label, url) => handleAddLink(addingToCategory, label, url)}
          onCancel={() => setAddingToCategory(null)}
          isPending={isCreateLinkPending}
          error={createLinkError}
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
        isUpdateCategoryPending={isUpdateCategoryPending}
        isUpdateLinkPending={isUpdateLinkPending}
        updateCategoryError={updateCategoryError}
        updateLinkError={updateLinkError}
      />
    </section>
  )
}
