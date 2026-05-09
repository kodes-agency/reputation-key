// Link tree drag-and-drop reorder handlers

import { generateKeyBetween } from 'fractional-indexing'
import { arrayMove } from '@dnd-kit/sortable'
import { type DragEndEvent } from '@dnd-kit/core'

type Category = { id: string; title: string; sortKey: string }
type LinkItem = {
  id: string
  label: string
  url: string
  sortKey: string
  categoryId: string
}

export function useLinkTreeReorder(
  categories: Category[],
  links: LinkItem[],
  setCategories: (c: Category[] | ((prev: Category[]) => Category[])) => void,
  setLinks: (l: LinkItem[] | ((prev: LinkItem[]) => LinkItem[])) => void,
  reorderCategoriesMutation: { mutateAsync: (data: unknown) => Promise<unknown> },
  reorderLinksMutation: { mutateAsync: (data: unknown) => Promise<unknown> },
  portalId: string,
) {
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = categories.findIndex((c) => c.id === active.id)
    const newIndex = categories.findIndex((c) => c.id === over.id)
    const reordered = arrayMove(categories, oldIndex, newIndex)
    setCategories(reordered)
    const updates: { id: string; sortKey: string }[] = []
    for (const cat of reordered) {
      const prev = updates.length > 0 ? updates[updates.length - 1].sortKey : null
      updates.push({ id: cat.id, sortKey: generateKeyBetween(prev, null) })
    }
    try {
      await reorderCategoriesMutation({ data: { portalId, items: updates } })
    } catch {
      console.error('Failed to reorder categories')
    }
  }

  const handleReorderLinks = async (categoryId: string, reordered: LinkItem[]) => {
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
      await reorderLinksMutation({ data: { portalId, categoryId, items: updates } })
    } catch {
      console.error('Failed to reorder links')
    }
  }

  return { handleDragEnd, handleReorderLinks }
}
