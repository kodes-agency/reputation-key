// Portal context — list portal groups use case
// Per architecture: simple query use case — authorize, query, return.

import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { PortalGroup } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { getAccessiblePropertyIdsForPermission } from '#/shared/domain/property-access'
import { portalError } from '../../domain/errors'
import { propertyId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'

// fallow-ignore-next-line unused-type
export type ListPortalGroupsDeps = Readonly<{
  portalGroupRepo: PortalGroupRepository
  staffPublicApi: StaffPublicApi
}>

export const listPortalGroups =
  (deps: ListPortalGroupsDeps) =>
  async (
    input: { propertyId: string },
    ctx: AuthContext,
  ): Promise<ReadonlyArray<PortalGroup>> => {
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
    const groups = await deps.portalGroupRepo.listByProperty(
      ctx.organizationId,
      propertyId(input.propertyId),
    )
    if (accessible === null) {
      return groups
    }
    return groups.filter((g) => accessible.includes(g.propertyId))
  }

// fallow-ignore-next-line unused-type
export type ListPortalGroups = ReturnType<typeof listPortalGroups>
