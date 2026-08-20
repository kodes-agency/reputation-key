// Portal context — get portal group use case
// Per architecture: simple query use case — authorize, find, return.

import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { PortalGroup } from '../../domain/types'
import type { PortalId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { portalError } from '../../domain/errors'
import { portalGroupId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPropertyAccess } from '../assert-property-access'

export type GetPortalGroupDeps = Readonly<{
  portalGroupRepo: PortalGroupRepository
  staffPublicApi: StaffPublicApi
}>

export const getPortalGroup =
  (deps: GetPortalGroupDeps) =>
  async (
    input: { portalGroupId: string },
    ctx: AuthContext,
  ): Promise<PortalGroup & Readonly<{ portalIds: ReadonlyArray<PortalId> }>> => {
    if (!canForContext(ctx, 'portal.read')) {
      throw portalError('forbidden', 'No portal read permission')
    }

    const gid = portalGroupId(input.portalGroupId)
    const group = await deps.portalGroupRepo.findById(ctx.organizationId, gid)
    if (!group) {
      throw portalError('group_not_found', 'portal group not found in this organization')
    }
    // D6-001: verify caller's staff_assignment includes this group's property
    await assertPropertyAccess(deps.staffPublicApi, ctx, 'portal.read', group.propertyId)
    return {
      ...group,
      portalIds: await deps.portalGroupRepo.getGroupPortalIds(
        ctx.organizationId,
        group.id,
      ),
    }
  }

export type GetPortalGroup = ReturnType<typeof getPortalGroup>
