// Link tree mutations hook

import {
  useMutationAction,
  useMutationActionSilent,
} from '#/components/hooks/use-mutation-action'
import {
  createLinkCategory,
  reorderCategories,
  deleteLinkCategory,
  createLink,
  deleteLink,
  updateLink,
  updateLinkCategory,
  reorderLinks,
} from '#/contexts/portal/server/portal-links'

export function useLinkTreeMutations() {
  const createCategoryMutation = useMutationAction(createLinkCategory, {
    successMessage: 'Category created',
  })
  const createLinkMutation = useMutationAction(createLink, {
    successMessage: 'Link created',
  })
  const deleteCategoryMutation = useMutationActionSilent(deleteLinkCategory)
  const deleteLinkMutation = useMutationActionSilent(deleteLink)
  const reorderCategoriesMutation = useMutationActionSilent(reorderCategories)
  const reorderLinksMutation = useMutationActionSilent(reorderLinks)
  const updateLinkMutation = useMutationAction(updateLink, {
    successMessage: 'Link updated',
  })
  const updateCategoryMutation = useMutationAction(updateLinkCategory, {
    successMessage: 'Category updated',
  })

  return {
    createCategoryMutation,
    createLinkMutation,
    deleteCategoryMutation,
    deleteLinkMutation,
    reorderCategoriesMutation,
    reorderLinksMutation,
    updateLinkMutation,
    updateCategoryMutation,
  }
}
