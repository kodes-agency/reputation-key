// Link tree state management hook with mutations
import { useEffect, useState } from 'react'
import { useLinkTreeMutations } from './use-link-tree-mutations'
import { useLinkTreeReorder } from './use-link-tree-reorder'
import type { LinkTreeCategory, LinkTreeLink } from './link-tree-types'

/**
 * Which inline form produced the create/update error currently on screen.
 *
 * `useActionMutation` exposes no `reset()`, and one mutation object is shared by
 * every inline-form instance — so a failure while adding a link to category A
 * used to render under category B's empty inputs. Remembering the originating
 * form (and clearing it whenever a form opens, cancels or succeeds) scopes the
 * error to the instance that caused it.
 */
type ErrorScope = 'create-category' | 'create-link' | 'update-category' | 'update-link'

export function useLinkTreeState(
  portalId: string,
  initialCategories: readonly LinkTreeCategory[],
  initialLinks: readonly LinkTreeLink[],
) {
  const [categories, setCategories] = useState(initialCategories)
  const [links, setLinks] = useState(initialLinks)
  const [addingToCategory, setAddingToCategoryState] = useState<string | null>(null)
  const [editingLink, setEditingLinkState] = useState<string | null>(null)
  const [editingCategory, setEditingCategoryState] = useState<string | null>(null)
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null)
  const [deletingLinkId, setDeletingLinkIdState] = useState<string | null>(null)
  const [errorScope, setErrorScope] = useState<ErrorScope | null>(null)

  // The props ARE the `portalKeys.links(portalId)` query data (the route feeds it
  // straight through useSuspenseQuery), and every mutation below invalidates that
  // key. Resyncing the mirror on each refetch is what makes another session's
  // edits visible; previously the snapshot stayed authoritative until unmount.
  //
  // Chosen over dropping the mirror entirely because the drag rollback in
  // use-link-tree-reorder needs a synchronous local override of the server order;
  // doing that through the query cache would mean rewriting all four reorder
  // paths as cache writes for no user-visible gain. Consequence: the CRUD
  // handlers must NOT also patch the mirror by hand — the refetch has already
  // landed by the time `mutateAsync` resolves, so a manual append would double.
  useEffect(() => {
    setCategories(initialCategories)
  }, [initialCategories])
  useEffect(() => {
    setLinks(initialLinks)
  }, [initialLinks])

  const mutations = useLinkTreeMutations(portalId)

  // Opening, switching or cancelling any inline form discards a stale error.
  const setAddingToCategory = (catId: string | null) => {
    setErrorScope(null)
    setAddingToCategoryState(catId)
  }
  const setEditingLink = (linkId: string | null) => {
    setErrorScope(null)
    setEditingLinkState(linkId)
  }
  const setEditingCategory = (catId: string | null) => {
    setErrorScope(null)
    setEditingCategoryState(catId)
  }

  const handleAddCategory = async (title: string) => {
    setErrorScope('create-category')
    await mutations.createCategoryMutation({ data: { portalId, title } })
    setErrorScope(null)
  }

  const handleAddLink = async (categoryId: string, label: string, url: string) => {
    setErrorScope('create-link')
    await mutations.createLinkMutation({ data: { categoryId, portalId, label, url } })
    setAddingToCategory(null)
  }

  // Both deletes are triggered from AlertDialog `onClick`, whose prop type is
  // `void` — the caller cannot await, so an escaping rejection would surface
  // only as an `unhandledrejection`. Catch here; `actionError` renders it.
  const handleDeleteCategory = async (catId: string) => {
    setDeletingCategoryId(catId)
    await mutations
      .deleteCategoryMutation({ data: { categoryId: catId } })
      .catch(() => undefined)
    setDeletingCategoryId(null)
  }

  const handleDeleteLink = async (linkId: string) => {
    setDeletingLinkIdState(linkId)
    await mutations.deleteLinkMutation({ data: { linkId } }).catch(() => undefined)
    setDeletingLinkIdState(null)
  }

  const handleUpdateLink = async (linkId: string, label: string, url: string) => {
    setErrorScope('update-link')
    await mutations.updateLinkMutation({ data: { linkId, label, url } })
    setEditingLink(null)
  }

  const handleUpdateCategory = async (catId: string, title: string) => {
    setErrorScope('update-category')
    await mutations.updateCategoryMutation({ data: { categoryId: catId, title } })
    setEditingCategory(null)
  }

  const { handleDragEnd, handleReorderLinks } = useLinkTreeReorder(
    categories,
    links,
    setCategories,
    setLinks,
    mutations.reorderCategoriesMutation,
    mutations.reorderLinksMutation,
    portalId,
  )

  // Deletes and drag-reorders have no inline form of their own, so their failures
  // go to the section-level banner (same shape as portal-group-management.tsx).
  const actionError =
    mutations.deleteCategoryMutation.error ??
    mutations.deleteLinkMutation.error ??
    mutations.reorderCategoriesMutation.error ??
    mutations.reorderLinksMutation.error

  return {
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
    isCreateCategoryPending: mutations.createCategoryMutation.isPending,
    isCreateLinkPending: mutations.createLinkMutation.isPending,
    isUpdateCategoryPending: mutations.updateCategoryMutation.isPending,
    isUpdateLinkPending: mutations.updateLinkMutation.isPending,
    createCategoryError:
      errorScope === 'create-category' ? mutations.createCategoryMutation.error : null,
    createLinkError:
      errorScope === 'create-link' ? mutations.createLinkMutation.error : null,
    updateCategoryError:
      errorScope === 'update-category' ? mutations.updateCategoryMutation.error : null,
    updateLinkError:
      errorScope === 'update-link' ? mutations.updateLinkMutation.error : null,
    actionError,
    handleAddCategory,
    handleAddLink,
    handleDeleteCategory,
    handleDeleteLink,
    handleUpdateCategory,
    handleUpdateLink,
    handleDragEnd,
    handleReorderLinks,
  }
}
