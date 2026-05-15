// Link tree state management hook with mutations
import { useState } from 'react'
import { useLinkTreeMutations } from './use-link-tree-mutations'
import { useLinkTreeReorder } from './use-link-tree-reorder'
import type { LinkTreeCategory, LinkTreeLink } from './link-tree.types'

export function useLinkTreeState(
  portalId: string,
  initialCategories: readonly LinkTreeCategory[],
  initialLinks: readonly LinkTreeLink[],
) {
  const [categories, setCategories] = useState(initialCategories)
  const [links, setLinks] = useState(initialLinks)
  const [addingToCategory, setAddingToCategory] = useState<string | null>(null)
  const [editingLink, setEditingLink] = useState<string | null>(null)
  const [editingCategory, setEditingCategory] = useState<string | null>(null)
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null)
  const [deletingLinkId, setDeletingLinkIdState] = useState<string | null>(null)

  const mutations = useLinkTreeMutations()

  const handleAddCategory = async (title: string) => {
    const result = await mutations.createCategoryMutation({ data: { portalId, title } })
    setCategories((prev) => [
      ...prev,
      {
        id: result.category.id,
        title: result.category.title,
        sortKey: result.category.sortKey,
      },
    ])
  }

  const handleAddLink = async (categoryId: string, label: string, url: string) => {
    const result = await mutations.createLinkMutation({
      data: { categoryId, portalId, label, url },
    })
    setLinks((prev) => [
      ...prev,
      {
        id: result.link.id,
        label: result.link.label,
        url: result.link.url,
        sortKey: result.link.sortKey,
        categoryId,
      },
    ])
    setAddingToCategory(null)
  }

  const handleDeleteCategory = async (catId: string) => {
    setDeletingCategoryId(catId)
    try {
      await mutations.deleteCategoryMutation({ data: { categoryId: catId } })
      setCategories((prev) => prev.filter((c) => c.id !== catId))
      setLinks((prev) => prev.filter((l) => l.categoryId !== catId))
    } finally {
      setDeletingCategoryId(null)
    }
  }

  const handleDeleteLink = async (linkId: string) => {
    setDeletingLinkIdState(linkId)
    try {
      await mutations.deleteLinkMutation({ data: { linkId } })
      setLinks((prev) => prev.filter((l) => l.id !== linkId))
    } finally {
      setDeletingLinkIdState(null)
    }
  }

  const handleUpdateLink = async (linkId: string, label: string, url: string) => {
    const result = await mutations.updateLinkMutation({ data: { linkId, label, url } })
    setLinks((prev) =>
      prev.map((l) =>
        l.id === linkId ? { ...l, label: result.link.label, url: result.link.url } : l,
      ),
    )
    setEditingLink(null)
  }

  const handleUpdateCategory = async (catId: string, title: string) => {
    const result = await mutations.updateCategoryMutation({
      data: { categoryId: catId, title },
    })
    setCategories((prev) =>
      prev.map((c) => (c.id === catId ? { ...c, title: result.category.title } : c)),
    )
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
    createCategoryMutation: mutations.createCategoryMutation,
    createLinkMutation: mutations.createLinkMutation,
    updateCategoryMutation: mutations.updateCategoryMutation,
    updateLinkMutation: mutations.updateLinkMutation,
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
