// Link tree drag-and-drop reorder handlers — wiring only. The ordering
// decisions (which drops are inert, the new list, the sortKey chain) live in
// link-tree-reorder-rules.ts, where they are unit-tested.

import { type DragEndEvent } from '@dnd-kit/core'
import type { Action } from '#/components/hooks/use-action'
import { planCategoryReorder, planLinkReorder } from './link-tree-reorder-rules'
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
    const plan = planCategoryReorder(categories, event.active.id, event.over?.id)
    if (plan === null) return
    setCategories(plan.nextCategories)
    try {
      await reorderCategoriesMutation({ data: { portalId, items: plan.items } })
    } catch {
      // F119: Rollback optimistic UI update on failure. The rejection is also
      // surfaced by the FormErrorBanner in LinkTree (via the mutation's .error);
      // a console-only report left the list snapping back unexplained.
      setCategories(categories)
    }
  }

  const handleReorderLinks = async (
    categoryId: string,
    reordered: readonly LinkTreeLink[],
  ) => {
    const plan = planLinkReorder(links, categoryId, reordered)
    setLinks(plan.nextLinks)
    try {
      await reorderLinksMutation({
        data: { portalId, categoryId, items: plan.items },
      })
    } catch {
      // F119: Rollback optimistic UI update on failure. See above — the error is
      // rendered by LinkTree's FormErrorBanner rather than only logged.
      setLinks(links)
    }
  }

  return { handleDragEnd, handleReorderLinks }
}
