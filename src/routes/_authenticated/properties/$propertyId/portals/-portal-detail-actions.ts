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
  updatePortal,
} from '#/contexts/portal/server/portals'
import { downloadPortalPrintKit } from '#/contexts/portal/server/portal-print-kit'
import { publishPortalChanges } from '#/contexts/portal/server/portal-publish-changes'
import { updatePortalResponsibleManagers } from '#/contexts/portal/server/portal-responsible-managers'
import type { Action } from '#/components/hooks/use-action'
import {
  actionErrorMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import { openPageErrorMessage } from '#/components/features/portal/portal-workspace/portal-open-page'
import type { PortalLookActions } from '#/components/features/portal/portal-look/portal-look-types'
import { portalKeys } from '#/shared/queries/query-keys'
import type { UpdatePortalVariables } from '#/components/features/portal/shared/types'
import type { PortalQueryResult } from './-portal-detail-data'

type DownloadPortalPrintFinal =
  typeof import('#/contexts/portal/server/portal-print-final').downloadPortalPrintFinal

/** The final print kit's download, its server function's module loaded when it is first asked for. */
const downloadPortalPrintFinalLazily = async (
  input: Parameters<DownloadPortalPrintFinal>[0],
): Promise<Awaited<ReturnType<DownloadPortalPrintFinal>>> => {
  const { downloadPortalPrintFinal } =
    await import('#/contexts/portal/server/portal-print-final')
  return downloadPortalPrintFinal(input)
}

type PortalLookServer = typeof import('#/contexts/portal/server/portal-look')

/**
 * The three writes of a portal's own look, their server functions' module loaded
 * when one is first used: only an Account Admin on a property with a second
 * portal ever asks, and the first paint has no room for three more stubs.
 */
const savePortalLookColoursLazily = async (
  input: Parameters<PortalLookServer['savePortalLookColours']>[0],
): Promise<Awaited<ReturnType<PortalLookServer['savePortalLookColours']>>> => {
  const { savePortalLookColours } = await import('#/contexts/portal/server/portal-look')
  return savePortalLookColours(input)
}
const savePortalLookIdentityLazily = async (
  input: Parameters<PortalLookServer['savePortalLookIdentity']>[0],
): Promise<Awaited<ReturnType<PortalLookServer['savePortalLookIdentity']>>> => {
  const { savePortalLookIdentity } = await import('#/contexts/portal/server/portal-look')
  return savePortalLookIdentity(input)
}
const savePortalLookPhotoLazily = async (
  input: Parameters<PortalLookServer['savePortalLookPhoto']>[0],
): Promise<Awaited<ReturnType<PortalLookServer['savePortalLookPhoto']>>> => {
  const { savePortalLookPhoto } = await import('#/contexts/portal/server/portal-look')
  return savePortalLookPhoto(input)
}

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
function usePortalUpdateAction(propertyId: string, portalId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (input: UpdatePortalVariables) => updatePortal(input),
    onMutate: async (input: UpdatePortalVariables) => {
      const queryKey = portalKeys.detail(portalId)
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<PortalQueryResult>(queryKey)
      const { portalId: _portalId, ...patch } = input.data
      void _portalId
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
  }) as Action<UpdatePortalVariables>
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
  // Autosaved as it is typed, so silent on success (see usePortalUpdateAction).
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
    saveColours: useActionMutation(savePortalLookColoursLazily, { invalidateKeys }),
    saveIdentity: useActionMutation(savePortalLookIdentityLazily, { invalidateKeys }),
    savePhoto: useActionMutation(savePortalLookPhotoLazily, { invalidateKeys }),
  }
}

/**
 * The workspace header's "Open live page": the same reveal as "Download again", for
 * the purpose "show". It says why it failed itself (a rate limit, a retired
 * key) in Open live page's words, because the header has no banner to carry the error.
 * It shares the reveal's budget with "Download again" (ADR 0064).
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
  const autosaveUpdate = usePortalUpdateAction(propertyId, portalId)
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
  const downloadPrintKit = useActionMutation(downloadPortalPrintKit, {
    errorMessage: actionErrorMessage,
  })
  // The final print kit's download (PRINT_KIT_FINAL_ENABLED), silent the same way.
  // Loaded on first use: the first paint has no room for another server
  // function's stub, and only a manager who prints asks for it.
  const downloadPrintFinal = useActionMutation(downloadPortalPrintFinalLazily, {
    errorMessage: actionErrorMessage,
  })
  const revokeToken = useActionMutation(revokePortalTokens, {
    successMessage: 'All codes stopped',
    invalidateKeys: tokenInvalidations,
  })
  // The only producer of the governed portal.content_review.completed /
  // configuration_completeness / approved_destination_ratio facts. Legacy
  // recognition projections stay inactive; active Goal consumers observe the fact.
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
  // live one. A Portal that is not live goes live through `autosaveUpdate`.
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
    issueToken,
    rotateToken,
    revokeToken,
    revealAddress,
    downloadPrintKit,
    downloadPrintFinal,
    completeReview,
    updateResponsibleManagers,
    makeVersionLive,
    publishChanges,
    experience,
    look,
  }
}
