import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { portalKeys } from '#/shared/queries/query-keys'

/**
 * Portal Group writes affect five independent server projections: the group
 * list, the two Goal subject reads, the Portals overview (which names each
 * Portal's group) and its results (which add each Portal to its group's row).
 * Keeping the complete property-scoped fan-out here prevents a mutation route
 * from updating the management list while leaving Goal subject labels stale.
 */
function affectedProjectionKeys(propertyId: string): readonly QueryKey[] {
  return [
    portalKeys.groups(propertyId),
    portalKeys.goalSubjects(propertyId),
    portalKeys.goalSubjectNames(propertyId),
    portalKeys.overview(propertyId),
  ]
}

async function invalidateAffectedProjections(
  queryClient: QueryClient,
  propertyId: string,
): Promise<void> {
  await Promise.all([
    ...affectedProjectionKeys(propertyId).map((queryKey) =>
      queryClient.invalidateQueries({ queryKey, exact: true }),
    ),
    // One read per window: the root stands for all of them, so not exact.
    queryClient.invalidateQueries({
      queryKey: portalKeys.resultsOverviewRoot(propertyId),
      exact: false,
    }),
  ])
}

export const portalGroupCachePolicy = {
  onGroupCreated: invalidateAffectedProjections,
  onGroupUpdated: invalidateAffectedProjections,
  onGroupDeleted: invalidateAffectedProjections,
  onGroupMemberAdded: invalidateAffectedProjections,
  onGroupMemberRemoved: invalidateAffectedProjections,
} as const

export type PortalGroupCachePolicy = typeof portalGroupCachePolicy
