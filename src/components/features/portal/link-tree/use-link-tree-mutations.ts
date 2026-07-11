// Link tree mutations hook

import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { portalKeys } from '#/shared/queries/query-keys'
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

export function useLinkTreeMutations(portalId: string) {
  const createCategoryMutation = useActionMutation(createLinkCategory, {
    successMessage: 'Category created',
    invalidateKeys: [portalKeys.links(portalId)],
  })
  const createLinkMutation = useActionMutation(createLink, {
    successMessage: 'Link created',
    invalidateKeys: [portalKeys.links(portalId)],
  })
  const deleteCategoryMutation = useActionMutation(deleteLinkCategory, {
    invalidateKeys: [portalKeys.links(portalId)],
  })
  const deleteLinkMutation = useActionMutation(deleteLink, {
    invalidateKeys: [portalKeys.links(portalId)],
  })
  const reorderCategoriesMutation = useActionMutation(reorderCategories, {
    invalidateKeys: [portalKeys.links(portalId)],
  })
  const reorderLinksMutation = useActionMutation(reorderLinks, {
    invalidateKeys: [portalKeys.links(portalId)],
  })
  const updateLinkMutation = useActionMutation(updateLink, {
    successMessage: 'Link updated',
    invalidateKeys: [portalKeys.links(portalId)],
  })
  const updateCategoryMutation = useActionMutation(updateLinkCategory, {
    successMessage: 'Category updated',
    invalidateKeys: [portalKeys.links(portalId)],
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
