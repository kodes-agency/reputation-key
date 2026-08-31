import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import {
  completeContentReview,
  approvePortalApprovedDestination,
  disablePortalApprovedDestination,
  finalizeUpload,
  issuePortalToken,
  requestUploadUrl,
  requestPortalApprovedDestination,
  revokePortalTokens,
  rotatePortalToken,
  savePortalLocalizedOverride,
  savePropertyPortalBrandContent,
  savePropertyPortalBrandProfile,
  updatePortal,
} from '#/contexts/portal/server/portals'
import { updatePortalResponsibleManagers } from '#/contexts/portal/server/portal-responsible-managers'
import type { Action } from '#/components/hooks/use-action'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { portalKeys } from '#/shared/queries/query-keys'
import type { UpdatePortalVariables } from '#/components/features/portal/shared/types'
import type { PortalQueryResult } from './-portal-detail-data'

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
      toast.success('Portal updated')
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
  const destinationInvalidations = [
    portalKeys.approvedDestinations(portalId),
    portalKeys.publicationHistory(portalId),
    portalKeys.links(portalId),
  ]
  const saveProfile = useActionMutation(savePropertyPortalBrandProfile, {
    successMessage: 'Property brand saved',
    invalidateKeys: experienceInvalidations,
  })
  const saveContent = useActionMutation(savePropertyPortalBrandContent, {
    successMessage: 'Guest content saved',
    invalidateKeys: experienceInvalidations,
  })
  const saveOverride = useActionMutation(savePortalLocalizedOverride, {
    successMessage: 'Portal wording saved',
    invalidateKeys: experienceInvalidations,
  })
  const requestDestination = useActionMutation(requestPortalApprovedDestination, {
    successMessage: 'Destination added',
    invalidateKeys: destinationInvalidations,
  })
  const approveDestination = useActionMutation(approvePortalApprovedDestination, {
    successMessage: 'Destination approved',
    invalidateKeys: destinationInvalidations,
  })
  const disableDestination = useActionMutation(disablePortalApprovedDestination, {
    successMessage: 'Destination disabled',
    invalidateKeys: destinationInvalidations,
  })
  return {
    saveProfile,
    saveContent,
    saveOverride,
    requestDestination,
    approveDestination,
    disableDestination,
  }
}

/**
 * Every write the portal detail screen can perform. Hook order is fixed and
 * unconditional, so the bundle is safe to call from the route component the
 * same way the individual hooks were.
 */
export function usePortalDetailActions(propertyId: string, portalId: string) {
  const update = usePortalUpdateAction(propertyId, portalId)
  const issueToken = useActionMutation(issuePortalToken, {
    successMessage: 'Public link generated',
  })
  const rotateToken = useActionMutation(rotatePortalToken, {
    successMessage: 'Public link rotated',
  })
  const revokeToken = useActionMutation(revokePortalTokens, {
    successMessage: 'Public links revoked',
  })
  // The only producer of the governed portal.content_review.completed /
  // configuration_completeness / approved_destination_ratio facts. Legacy
  // recognition projections stay inactive; active Goal consumers observe the fact.
  const completeReview = useActionMutation(completeContentReview, {
    successMessage: 'Content review recorded',
    invalidateKeys: [portalKeys.detail(portalId)],
  })
  const updateResponsibleManagers = useActionMutation(updatePortalResponsibleManagers, {
    successMessage: 'Responsible managers updated',
    invalidateKeys: [
      portalKeys.detail(portalId),
      portalKeys.responsibleManagers(portalId),
    ],
  })
  const experience = usePortalExperienceActions(propertyId, portalId)
  const requestUploadUrlFn = useServerFn(requestUploadUrl)
  const finalizeUploadFn = useServerFn(finalizeUpload)

  return {
    update,
    issueToken,
    rotateToken,
    revokeToken,
    completeReview,
    updateResponsibleManagers,
    experience,
    requestUploadUrlFn,
    finalizeUploadFn,
  }
}
