// Portal context — pure ordering rules behind link-tree drag-and-drop.
//
// Both drag surfaces (the category list in use-link-tree-reorder.ts and the
// per-category link list in sortable-category.tsx) used to carry their own copy
// of the same guard-and-move logic, including their own copy of the -1 bug
// documented below. They share this module now so the rule has one definition.

import { arrayMove } from '@dnd-kit/sortable'
import { generateKeyBetween } from 'fractional-indexing'
import type { LinkTreeCategory, LinkTreeLink } from './link-tree-types'

/** dnd-kit's `UniqueIdentifier`, restated so the rules stay free of the kit. */
type DragId = string | number

/** One row's position in the order about to be persisted. */
export type SortKeyUpdate = Readonly<{ id: string; sortKey: string }>

/**
 * The list a drag produced, or `null` when the drag must change nothing.
 *
 * Three drops are inert and must NOT reach a mutation: a drop outside every
 * sortable (`over` is null, so no id arrives), a drop back onto the dragged row,
 * and a drop whose active or over id belongs to a different sortable context —
 * the link handles are nested inside the category context, so a link drag also
 * surfaces at the category `onDragEnd` carrying ids no category owns.
 *
 * That third case is why the two index checks are OR'd rather than AND'd: with
 * `&&`, a lone -1 slipped through, `arrayMove` spliced at -1, and the wrong row
 * was silently reordered — and then persisted.
 */
export function reorderById<T extends { readonly id: string }>(
  items: readonly T[],
  activeId: DragId,
  overId: DragId | undefined,
): T[] | null {
  if (overId === undefined || activeId === overId) return null
  const oldIndex = items.findIndex((item) => item.id === activeId)
  const newIndex = items.findIndex((item) => item.id === overId)
  if (oldIndex === -1 || newIndex === -1) return null
  return arrayMove([...items], oldIndex, newIndex)
}

/**
 * An ascending sortKey chain, one key per row, in the list's new visual order.
 *
 * Every key is generated strictly after the previous one instead of between the
 * neighbours' existing keys: a reorder rewrites the whole list, so re-deriving
 * the chain from scratch is what makes the persisted order match what the user
 * just dropped regardless of what the old keys were.
 */
function resequenceSortKeys(items: readonly { readonly id: string }[]): SortKeyUpdate[] {
  const updates: SortKeyUpdate[] = []
  for (const item of items) {
    const prev = updates.length > 0 ? updates[updates.length - 1].sortKey : null
    updates.push({ id: item.id, sortKey: generateKeyBetween(prev, null) })
  }
  return updates
}

export type CategoryReorderPlan = Readonly<{
  nextCategories: LinkTreeCategory[]
  items: SortKeyUpdate[]
}>

/**
 * What a category drag should do: the list to show immediately and the order to
 * persist, or `null` for an inert drop.
 *
 * The keys describe `nextCategories`, never the pre-drag list — the optimistic
 * render and the mutation payload have to be two views of one decision, or the
 * refetch snaps the list back to an order the user never chose.
 */
export function planCategoryReorder(
  categories: readonly LinkTreeCategory[],
  activeId: DragId,
  overId: DragId | undefined,
): CategoryReorderPlan | null {
  const nextCategories = reorderById(categories, activeId, overId)
  if (nextCategories === null) return null
  return { nextCategories, items: resequenceSortKeys(nextCategories) }
}

export type LinkReorderPlan = Readonly<{
  nextLinks: LinkTreeLink[]
  items: SortKeyUpdate[]
}>

/**
 * Every link after one category's list is reordered, plus the order to persist.
 *
 * The mirror holds all categories' links in one flat array, so the reordered
 * slice cannot just be spliced back in place. The links of the OTHER categories
 * are kept — selected by `!==`, the exact inverse of the slice being replaced,
 * so no link is dropped and none is listed twice — and the dragged category's
 * links are re-appended carrying their freshly generated keys. Reusing the old
 * keys would render the drop and then undo it on the next refetch.
 */
export function planLinkReorder(
  links: readonly LinkTreeLink[],
  categoryId: string,
  reordered: readonly LinkTreeLink[],
): LinkReorderPlan {
  const items = resequenceSortKeys(reordered)
  return {
    items,
    nextLinks: [
      ...links.filter((link) => link.categoryId !== categoryId),
      ...reordered.map((link, index) => ({ ...link, sortKey: items[index].sortKey })),
    ],
  }
}
