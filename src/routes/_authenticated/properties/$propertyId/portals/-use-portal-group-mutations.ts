// The Portal Group commands of the Portals page, each with its cache policy.
import { useQueryClient } from '@tanstack/react-query'
import {
  addPortalToGroup,
  createPortalGroup,
  removePortalFromGroup,
  softDeletePortalGroup,
  updatePortalGroup,
} from '#/contexts/portal/server/portal-groups'
import { portalGroupCachePolicy } from '#/components/features/portal/portal-group-cache-policy'
import { useActionMutation } from '#/components/hooks/use-action-mutation'

export function usePortalGroupMutations(propertyId: string) {
  const queryClient = useQueryClient()
  const createGroupMutation = useActionMutation(createPortalGroup, {
    successMessage: 'Portal group created',
    onSuccess: () => portalGroupCachePolicy.onGroupCreated(queryClient, propertyId),
  })
  const updateGroupMutation = useActionMutation(updatePortalGroup, {
    successMessage: 'Portal group updated',
    onSuccess: () => portalGroupCachePolicy.onGroupUpdated(queryClient, propertyId),
  })
  const deleteGroupMutation = useActionMutation(softDeletePortalGroup, {
    successMessage: 'Portal group archived',
    onSuccess: () => portalGroupCachePolicy.onGroupDeleted(queryClient, propertyId),
  })
  const addPortalToGroupMutation = useActionMutation(addPortalToGroup, {
    successMessage: 'Portal added to group',
    onSuccess: () => portalGroupCachePolicy.onGroupMemberAdded(queryClient, propertyId),
  })
  const removePortalFromGroupMutation = useActionMutation(removePortalFromGroup, {
    successMessage: 'Portal removed from group',
    onSuccess: () => portalGroupCachePolicy.onGroupMemberRemoved(queryClient, propertyId),
  })

  return {
    createGroupMutation,
    updateGroupMutation,
    deleteGroupMutation,
    addPortalToGroupMutation,
    removePortalFromGroupMutation,
  }
}
