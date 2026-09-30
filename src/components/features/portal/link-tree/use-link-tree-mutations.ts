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

export function useLinkTreeMutations(propertyId: string, portalId: string) {
  // Any link or category edit changes the working copy, so the workspace
  // header's "N changes not live" note (read from the publication history) must
  // refresh with the tree.
  // The same edit changes which wording a language is missing.
  const invalidateKeys = [
    portalKeys.links(portalId),
    portalKeys.languageCoverage(propertyId, portalId),
    portalKeys.publicationHistory(portalId),
  ]
  const createCategoryMutation = useActionMutation(createLinkCategory, {
    successMessage: 'Category created',
    invalidateKeys,
  })
  const createLinkMutation = useActionMutation(createLink, {
    successMessage: 'Link created',
    invalidateKeys,
  })
  // Deletes were silent on BOTH paths: no toast on success, no rendered error on
  // failure, so the user could not tell one from the other. A success message
  // here plus the FormErrorBanner in LinkTree makes both outcomes observable.
  const deleteCategoryMutation = useActionMutation(deleteLinkCategory, {
    successMessage: 'Category deleted',
    invalidateKeys,
  })
  const deleteLinkMutation = useActionMutation(deleteLink, {
    successMessage: 'Link deleted',
    invalidateKeys,
  })
  const reorderCategoriesMutation = useActionMutation(reorderCategories, {
    invalidateKeys,
  })
  const reorderLinksMutation = useActionMutation(reorderLinks, {
    invalidateKeys,
  })
  const updateLinkMutation = useActionMutation(updateLink, {
    successMessage: 'Link updated',
    invalidateKeys,
  })
  const updateCategoryMutation = useActionMutation(updateLinkCategory, {
    successMessage: 'Category updated',
    invalidateKeys,
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
