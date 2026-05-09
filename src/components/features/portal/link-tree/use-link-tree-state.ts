// Link tree state management hook with mutations
import { useState } from 'react'
import { toast } from 'sonner'
import { useLinkTreeMutations } from './use-link-tree-mutations'
import { useLinkTreeReorder } from './use-link-tree-reorder'

type Category = { id: string; title: string; sortKey: string }
type LinkItem = {
  id: string
  label: string
  url: string
  sortKey: string
  categoryId: string
}
export function useLinkTreeState(
  portalId: string,
  initialCategories: Category[],
  initialLinks: LinkItem[],
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
    try {
      const result = await mutations.createCategoryMutation({ data: { portalId, title } })
      setCategories((prev) => [
        ...prev,
        {
          id: result.category.id,
          title: result.category.title,
          sortKey: result.category.sortKey,
        },
      ])
    } catch {
      toast.error('Failed to create category')
    }
  }

  const handleAddLink = async (categoryId: string, label: string, url: string) => {
    try {
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
    } catch {
      toast.error('Failed to create link')
    }
  }

  const handleDeleteCategory = async (catId: string) => {
    setDeletingCategoryId(catId)
    try {
      await mutations.deleteCategoryMutation({ data: { categoryId: catId } })
      setCategories((prev) => prev.filter((c) => c.id !== catId))
      setLinks((prev) => prev.filter((l) => l.categoryId !== catId))
    } catch {
      toast.error('Failed to delete category')
    } finally {
      setDeletingCategoryId(null)
    }
  }

  const handleDeleteLink = async (linkId: string) => {
    setDeletingLinkIdState(linkId)
    try {
      await mutations.deleteLinkMutation({ data: { linkId } })
      setLinks((prev) => prev.filter((l) => l.id !== linkId))
    } catch {
      toast.error('Failed to delete link')
    } finally {
      setDeletingLinkIdState(null)
    }
  }

  const handleUpdateLink = async (linkId: string, label: string, url: string) => {
    try {
      const result = await mutations.updateLinkMutation({ data: { linkId, label, url } })
      setLinks((prev) =>
        prev.map((l) =>
          l.id === linkId ? { ...l, label: result.link.label, url: result.link.url } : l,
        ),
      )
      setEditingLink(null)
    } catch {
      toast.error('Failed to update link')
    }
  }

  const handleUpdateCategory = async (catId: string, title: string) => {
    try {
      const result = await mutations.updateCategoryMutation({
        data: { categoryId: catId, title },
      })
      setCategories((prev) =>
        prev.map((c) => (c.id === catId ? { ...c, title: result.category.title } : c)),
      )
      setEditingCategory(null)
    } catch {
      toast.error('Failed to update category')
    }
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
