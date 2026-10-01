// Portal context — list portal groups use case
// Per architecture: simple query use case — authorize, query, return.

import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { PortalGroup } from '../../domain/types'
import type { PortalId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { getAccessiblePropertyIdsForPermission } from '#/shared/domain/property-access'
import { portalError } from '../../domain/errors'
import { propertyId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'

export type ListPortalGroupsDeps = Readonly<{
  portalGroupRepo: PortalGroupRepository
  staffPublicApi: StaffPublicApi
}>

export type PortalGroupWithPortals = PortalGroup &
  Readonly<{ portalIds: ReadonlyArray<PortalId> }>

export const listPortalGroups =
  (deps: ListPortalGroupsDeps) =>
  async (
    input: { propertyId: string },
    ctx: AuthContext,
  ): Promise<ReadonlyArray<PortalGroupWithPortals>> => {
    if (!canForContext(ctx, 'portal.read')) {
      throw portalError('forbidden', 'No portal read permission')
    }
    // D6-001: scope reads to properties in the caller's staff_assignment.
    // AccountAdmin bypasses (getAccessiblePropertyIds returns null).
    const accessible = await getAccessiblePropertyIdsForPermission(
      (orgId, userId, orgWide) =>
        deps.staffPublicApi.getAccessiblePropertyIds(orgId, userId, orgWide),
      ctx,
      'portal.read',
    )
    // One batched read: the groups of the Property with their current Portals.
    const groups = await deps.portalGroupRepo.listPortalGroupsWithPortals(
      ctx.organizationId,
      propertyId(input.propertyId),
    )
    return accessible === null
      ? groups
      : groups.filter((group) => accessible.includes(group.propertyId))
  }

export type ListPortalGroups = ReturnType<typeof listPortalGroups>
