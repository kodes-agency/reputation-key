import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { portalKeys } from '#/shared/queries/query-keys'

/**
 * Portal Group writes affect three independent server projections. Keeping the
 * complete property-scoped fan-out here prevents a mutation route from updating
 * the management list while leaving Goal subject labels stale.
 */
function affectedProjectionKeys(propertyId: string): readonly QueryKey[] {
  return [
    portalKeys.groups(propertyId),
    portalKeys.goalSubjects(propertyId),
    portalKeys.goalSubjectNames(propertyId),
  ]
}

async function invalidateAffectedProjections(
  queryClient: QueryClient,
  propertyId: string,
): Promise<void> {
  await Promise.all(
    affectedProjectionKeys(propertyId).map((queryKey) =>
      queryClient.invalidateQueries({ queryKey, exact: true }),
    ),
  )
}

export const portalGroupCachePolicy = {
  onGroupCreated: invalidateAffectedProjections,
  onGroupUpdated: invalidateAffectedProjections,
  onGroupDeleted: invalidateAffectedProjections,
  onGroupMemberAdded: invalidateAffectedProjections,
  onGroupMemberRemoved: invalidateAffectedProjections,
} as const

export type PortalGroupCachePolicy = typeof portalGroupCachePolicy
