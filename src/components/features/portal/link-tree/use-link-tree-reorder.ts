// Link tree drag-and-drop reorder handlers

import { generateKeyBetween } from 'fractional-indexing'
import { arrayMove } from '@dnd-kit/sortable'
import { type DragEndEvent } from '@dnd-kit/core'
import type { Action } from '#/components/hooks/use-action'
import { getLogger } from '#/shared/observability/logger'
import type { LinkTreeCategory, LinkTreeLink } from './link-tree-types'

type ReorderCategoriesVariables = {
  data: {
    portalId: string
    items: Array<{ id: string; sortKey: string }>
  }
}

type ReorderLinksVariables = {
  data: {
    portalId: string
    categoryId: string
    items: Array<{ id: string; sortKey: string }>
  }
}

export function useLinkTreeReorder(
  categories: readonly LinkTreeCategory[],
  links: readonly LinkTreeLink[],
  setCategories: (
    value:
      | readonly LinkTreeCategory[]
      | ((prev: readonly LinkTreeCategory[]) => readonly LinkTreeCategory[]),
  ) => void,
  setLinks: (
    value:
      | readonly LinkTreeLink[]
      | ((prev: readonly LinkTreeLink[]) => readonly LinkTreeLink[]),
  ) => void,
  reorderCategoriesMutation: Action<ReorderCategoriesVariables>,
  reorderLinksMutation: Action<ReorderLinksVariables>,
  portalId: string,
) {
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    // F115: Only process drag-end events where the active item is a category.
    // Link reordering is handled by handleReorderLinks instead.
    if (!over || active.id === over.id) return
    const oldIndex = categories.findIndex((c) => c.id === active.id)
    const newIndex = categories.findIndex((c) => c.id === over.id)
    // Skip if neither active nor over is a category (e.g. link drag)
    if (oldIndex === -1 && newIndex === -1) return
    const reordered = arrayMove([...categories], oldIndex, newIndex)
    setCategories(reordered)
    const updates: { id: string; sortKey: string }[] = []
    for (const cat of reordered) {
      const prev = updates.length > 0 ? updates[updates.length - 1].sortKey : null
      updates.push({ id: cat.id, sortKey: generateKeyBetween(prev, null) })
    }
    try {
      await reorderCategoriesMutation({ data: { portalId, items: updates } })
    } catch {
      // F119: Rollback optimistic UI update on failure
      setCategories(categories)
      getLogger().error('Failed to reorder categories')
    }
  }

  const handleReorderLinks = async (
    categoryId: string,
    reordered: readonly LinkTreeLink[],
  ) => {
    const otherLinks = links.filter((l) => l.categoryId !== categoryId)
    const updates: { id: string; sortKey: string }[] = []
    for (const link of reordered) {
      const prev = updates.length > 0 ? updates[updates.length - 1].sortKey : null
      updates.push({ id: link.id, sortKey: generateKeyBetween(prev, null) })
    }
    setLinks([
      ...otherLinks,
      ...reordered.map((l, i) => ({ ...l, sortKey: updates[i].sortKey })),
    ])
    try {
      await reorderLinksMutation({
        data: { portalId, categoryId, items: updates },
      })
    } catch {
      // F119: Rollback optimistic UI update on failure
      setLinks(links)
      getLogger().error('Failed to reorder links')
    }
  }

  return { handleDragEnd, handleReorderLinks }
}
