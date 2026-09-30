// The Linktree section's writes, as actions. The only place the section touches
// server functions (the documented link-tree exception in
// scripts/check-component-boundaries.mjs), so the components stay presentational
// and a story can hand them stub actions.

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  actionErrorMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import { portalKeys } from '#/shared/queries/query-keys'
import {
  createLink,
  deleteLink,
  reorderLinks,
  saveLinktreeSettings,
  savePortalLinkTexts,
  updateLink,
} from '#/contexts/portal/server/portal-links'
import type { PortalLinktreeView } from '#/contexts/portal/application/public-api'
import { applyLinkOrder } from './linktree-rules'

/** Which tile's address change was refused, and why: one shared action, many tiles. */
export type LinkUpdateFailure = Readonly<{ linkId: string; error: unknown }>

export function useLinktreeMutations(portalId: string) {
  const queryClient = useQueryClient()
  const [updateFailure, setUpdateFailure] = useState<LinkUpdateFailure | null>(null)
  const linktreeKey = portalKeys.linktree(portalId)
  // Any link edit changes the working copy, so the header's "N changes not live"
  // note (read from the publication history) and the editor's link count refresh
  // with the section.
  const invalidateKeys = [
    linktreeKey,
    portalKeys.links(portalId),
    portalKeys.publicationHistory(portalId),
  ]
  /** Show a change at once; the returned thunk puts the old view back if the write fails. */
  const showNow = (change: (view: PortalLinktreeView) => PortalLinktreeView) => {
    const before = queryClient.getQueryData<PortalLinktreeView>(linktreeKey)
    if (before === undefined) return undefined
    queryClient.setQueryData<PortalLinktreeView>(linktreeKey, change(before))
    return () => queryClient.setQueryData<PortalLinktreeView>(linktreeKey, before)
  }

  return {
    // Typed text is written by the editor's autosave, so these are silent: the
    // header's "Draft saved" is the acknowledgement.
    saveTexts: useActionMutation(savePortalLinkTexts, { invalidateKeys }),
    saveSettings: useActionMutation(saveLinktreeSettings, {
      invalidateKeys,
      errorMessage: actionErrorMessage,
      optimistic: ({ data }) =>
        data.enabled === undefined
          ? undefined
          : showNow((view) => ({ ...view, enabled: data.enabled ?? view.enabled })),
    }),
    // These render their own failure beside the control that caused it.
    createLink: useActionMutation(createLink, { invalidateKeys }),
    updateLink: useActionMutation(updateLink, {
      invalidateKeys,
      onSuccess: () => setUpdateFailure(null),
      onError: (error, { data }) => setUpdateFailure({ linkId: data.linkId, error }),
    }),
    /** The refusal of the last link change, to show beside the tile it came from. */
    updateFailure,
    clearUpdateFailure: () => setUpdateFailure(null),
    deleteLink: useActionMutation(deleteLink, {
      successMessage: 'Link deleted',
      errorMessage: actionErrorMessage,
      invalidateKeys,
    }),
    reorderLinks: useActionMutation(reorderLinks, {
      invalidateKeys,
      errorMessage: actionErrorMessage,
      optimistic: ({ data }) =>
        showNow((view) => ({
          ...view,
          links: applyLinkOrder(view.links, {
            categoryId: data.categoryId,
            items: data.items,
          }),
        })),
    }),
  }
}

export type LinktreeMutations = ReturnType<typeof useLinktreeMutations>
