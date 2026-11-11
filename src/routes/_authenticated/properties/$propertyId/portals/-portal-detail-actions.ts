import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  completeContentReview,
  approvePortalApprovedDestination,
  disablePortalApprovedDestination,
  issuePortalToken,
  requestPortalApprovedDestination,
  revealPortalAddress,
  revokePortalTokens,
  rollbackPortalPublication,
  rotatePortalToken,
  savePortalLocalizedOverride,
  savePropertyPortalBrandContent,
  updatePortalSettings,
  changePortalLanguages,
  publishPortal,
} from '#/contexts/portal/server/portals'
import { publishPortalChanges } from '#/contexts/portal/server/portal-publish-changes'
import { updatePortalResponsibleManagers } from '#/contexts/portal/server/portal-responsible-managers'
import type { Action } from '#/components/hooks/use-action'
import {
  actionErrorMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import { openPageErrorMessage } from '#/components/features/portal/portal-workspace/portal-open-page'
import type { PortalLookActions } from '#/contexts/portal/look/ui/portal-look-types'
import { portalKeys } from '#/shared/queries/query-keys'
import type {
  ChangePortalLanguagesVariables,
  UpdatePortalVariables,
} from '#/components/features/portal/shared/types'
import type { PortalQueryResult } from './-portal-detail-data'
import {
  downloadPortalPrintFinal,
  savePortalPrintWording,
} from '#/contexts/portal/server/portal-print-final'
import {
  savePortalLookColours,
  savePortalLookIdentity,
  savePortalLookPhoto,
} from '#/contexts/portal/server/portal-look'

/**
 * The portal patch, for every section that saves one. It is silent on success:
 * a section's save, a language change among them, is acknowledged by the
 * header's "Draft saved" (a toast per pause in typing would be noise), and
 * going live from Review & publish is reported by that page.
 *
 * A `useMutation` shaped as an `Action`, not `useActionMutation`: the patch is
 * drawn at once and taken back on a refusal, and that needs the in-flight read
 * of the Portal cancelled before the cache is written (`onMutate` awaits
 * `cancelQueries`), which `useActionMutation`'s synchronous `optimistic` cannot
 * do. A refusal is reported by the caller that awaits the action: the header's
 * save status, or the Review page.
 */
/** What an edit changes on the Portal as the page already shows it. */
function drawnFields(input: { data: { portalId: string } }): Record<string, unknown> {
  const { portalId: _portalId, ...patch } = input.data
  void _portalId
  return patch
}

function usePortalAutosaveAction<V extends { data: { portalId: string } }>(
  propertyId: string,
  portalId: string,
  write: (input: V) => Promise<unknown>,
  drawn: (input: V) => Record<string, unknown>,
) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: write,
    onMutate: async (input: V) => {
      const queryKey = portalKeys.detail(portalId)
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<PortalQueryResult>(queryKey)
      const patch = drawn(input)
      queryClient.setQueryData<PortalQueryResult>(queryKey, (current) =>
        current?.portal
          ? { ...current, portal: { ...current.portal, ...patch } }
          : current,
      )
      return { previous }
    },
    onError: async (_error, _input, context) => {
      const queryKey = portalKeys.detail(portalId)
      queryClient.setQueryData(queryKey, context?.previous)
      await queryClient.refetchQueries({ queryKey, exact: true })
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: portalKeys.detail(portalId) }),
        queryClient.invalidateQueries({ queryKey: portalKeys.links(portalId) }),
        queryClient.invalidateQueries({ queryKey: portalKeys.list(propertyId) }),
        queryClient.invalidateQueries({
          queryKey: portalKeys.experience(propertyId, portalId),
        }),
        queryClient.invalidateQueries({
          queryKey: portalKeys.publicationHistory(portalId),
        }),
      ])
    },
  })

  return Object.assign(mutation.mutateAsync, {
    isPending: mutation.isPending,
    error: mutation.error,
    isSuccess: mutation.isSuccess,
    data: mutation.data ?? null,
  }) as Action<V>
}

/**
 * Brand/content edits and approved-destination governance. Both groups
 * invalidate the guest-facing experience projection, so they share one
 * invalidation set and one hook.
 */
function usePortalExperienceActions(propertyId: string, portalId: string) {
  const experienceInvalidations = [
    portalKeys.experience(propertyId, portalId),
    portalKeys.publicationHistory(portalId),
  ]
  // The editor's Linktree reads each tile's approval, so an approval or a
  // turn-off refreshes it too: the tile that opens the site says so at once.
  const destinationInvalidations = [
    portalKeys.approvedDestinations(portalId),
    portalKeys.publicationHistory(portalId),
    portalKeys.links(portalId),
    portalKeys.linktree(portalId),
  ]
  const saveContent = useActionMutation(savePropertyPortalBrandContent, {
    successMessage: 'Guest content saved',
    invalidateKeys: experienceInvalidations,
  })
  // Autosaved as it is typed, so silent on success (see usePortalAutosaveAction).
  const saveOverride = useActionMutation(savePortalLocalizedOverride, {
    invalidateKeys: experienceInvalidations,
  })
  const requestDestination = useActionMutation(requestPortalApprovedDestination, {
    successMessage: 'Site added',
    invalidateKeys: destinationInvalidations,
  })
  // Approving is a row action: a refusal is a toast. Disabling is confirmed in a
  // dialog that stays open and says a refusal itself, so it passes no toast.
  const approveDestination = useActionMutation(approvePortalApprovedDestination, {
    successMessage: 'Site approved',
    errorMessage: actionErrorMessage,
    invalidateKeys: destinationInvalidations,
  })
  const disableDestination = useActionMutation(disablePortalApprovedDestination, {
    successMessage: 'Site turned off',
    invalidateKeys: destinationInvalidations,
  })
  return {
    saveContent,
    saveOverride,
    requestDestination,
    approveDestination,
    disableDestination,
  }
}

/**
 * A portal's own look (the Look section): colours, name and logo, and photo. Each
 * write changes the draft guests will see, so everything that draws or reviews
 * it is read again: the Portal's settings (the editor), the draft preview and the
 * review and print kit under the publication history (with the header's "N
 * changes not live"), the Portals overview (its waiting changes) and the
 * property's settings (the Property look page's rail and its batch review).
 * Silent on success: the header's "Draft saved" is the acknowledgement for an
 * autosave, and a button on the section answers a refusal itself.
 */
function usePortalLookActions(propertyId: string, portalId: string): PortalLookActions {
  const invalidateKeys = [
    portalKeys.experience(propertyId, portalId),
    portalKeys.preview(portalId, 'draft'),
    portalKeys.publicationHistory(portalId),
    portalKeys.review(portalId),
    portalKeys.printKit(portalId),
    portalKeys.overview(propertyId),
    portalKeys.propertyExperience(propertyId),
    portalKeys.lookReview(propertyId),
  ]
  return {
    saveColours: useActionMutation(savePortalLookColours, { invalidateKeys }),
    saveIdentity: useActionMutation(savePortalLookIdentity, { invalidateKeys }),
    savePhoto: useActionMutation(savePortalLookPhoto, { invalidateKeys }),
  }
}

/**
 * The workspace header's "Open live page": the same reveal as "Download again", for
 * the purpose "show". It says why it failed itself (a rate limit, a retired
 * key) in Open live page's words, because the header has no banner to carry the error.
 * It shares the reveal's budget with "Download again".
 */
export function usePortalOpenPageReveal() {
  return useActionMutation(revealPortalAddress, { errorMessage: openPageErrorMessage })
}

/**
 * Every write the portal detail screen can perform. Hook order is fixed and
 * unconditional, so the bundle is safe to call from the route component the
 * same way the individual hooks were.
 */
export function usePortalDetailActions(propertyId: string, portalId: string) {
  const queryClient = useQueryClient()
  const autosaveUpdate = usePortalAutosaveAction<UpdatePortalVariables>(
    propertyId,
    portalId,
    (input) => updatePortalSettings(input),
    drawnFields,
  )
  const changeLanguages = usePortalAutosaveAction<ChangePortalLanguagesVariables>(
    propertyId,
    portalId,
    (input) => changePortalLanguages(input),
    drawnFields,
  )
  const goLive = usePortalAutosaveAction<{
    data: { portalId: string; reviewedDigest: string }
  }>(
    propertyId,
    portalId,
    (input) => publishPortal(input),
    () => ({ publicationState: 'published' }),
  )
  // Refetch the detail so `tokenStatus` (when the code was made, its transition
  // window) follows the code that was just made, replaced or stopped.
  const tokenInvalidations = [portalKeys.detail(portalId)]
  const issueToken = useActionMutation(issuePortalToken, {
    successMessage: 'Code made',
    invalidateKeys: tokenInvalidations,
  })
  const rotateToken = useActionMutation(rotatePortalToken, {
    successMessage: 'Code replaced',
    invalidateKeys: tokenInvalidations,
  })
  // Silent: the address appearing is the acknowledgement. Nothing to refetch,
  // since a download changes no state the page shows (History reads it itself).
  const revealAddress = useActionMutation(revealPortalAddress)
  // Silent on success (the browser's own download is the acknowledgement); a
  // refusal is a toast, because a download is an immediate action.
  // The print download, silent the same way.
  const downloadPrintFinal = useActionMutation(downloadPortalPrintFinal, {
    errorMessage: actionErrorMessage,
  })
  // "Save wording" beside it: a manager who saves asked for it, so it says so,
  // and a refusal is a toast like the download's.
  const savePrintWording = useActionMutation(savePortalPrintWording, {
    successMessage: 'Wording saved',
    errorMessage: actionErrorMessage,
  })
  const revokeToken = useActionMutation(revokePortalTokens, {
    successMessage: 'All codes stopped',
    invalidateKeys: tokenInvalidations,
  })
  const completeReview = useActionMutation(completeContentReview, {
    successMessage: 'Link check recorded',
    invalidateKeys: [portalKeys.detail(portalId)],
  })
  const updateResponsibleManagers = useActionMutation(updatePortalResponsibleManagers, {
    successMessage: 'Responsible managers saved',
    invalidateKeys: [
      portalKeys.detail(portalId),
      portalKeys.responsibleManagers(portalId),
    ],
    // A refused save means another admin changed the managers since this page
    // read them. The card keeps the refused edit, and its Reset shows that
    // change only once the page has read it (the read is fresh for 30
    // seconds). So the managers are re-read: those of the Portal the command
    // named, because this route is not remounted when its params change.
    onError: (_error, input) =>
      void queryClient.invalidateQueries({
        queryKey: portalKeys.responsibleManagers(input.data.portalId),
      }),
  })
  // "Make live again": moves the live activation to another version. The
  // Portal's detail holds the History reads and the header's status, and the
  // Portals overview shows what is live, so all three follow.
  const makeVersionLive = useActionMutation(rollbackPortalPublication, {
    successMessage: 'The version is live again',
    invalidateKeys: [
      portalKeys.detail(portalId),
      portalKeys.list(propertyId),
      portalKeys.overview(propertyId),
    ],
  })
  // Publish the draft of a Portal that is live: the next version replaces the
  // live one. A Portal that is not live goes live through `goLive`.
  // The page reports the outcome, so there is no toast here.
  const publishChanges = useActionMutation(publishPortalChanges, {
    invalidateKeys: [
      portalKeys.detail(portalId),
      portalKeys.list(propertyId),
      portalKeys.overview(propertyId),
    ],
  })
  const experience = usePortalExperienceActions(propertyId, portalId)
  const look = usePortalLookActions(propertyId, portalId)

  return {
    autosaveUpdate,
    changeLanguages,
    goLive,
    issueToken,
    rotateToken,
    revokeToken,
    revealAddress,
    downloadPrintFinal,
    savePrintWording,
    completeReview,
    updateResponsibleManagers,
    makeVersionLive,
    publishChanges,
    experience,
    look,
  }
}
