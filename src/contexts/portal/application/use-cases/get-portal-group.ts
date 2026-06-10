// Portal context — get portal group use case
// Per architecture: simple query use case — authorize, find, return.

import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { PortalGroup } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { can } from '#/shared/domain/permissions'
import { portalError } from '../../domain/errors'
import { portalGroupId } from '#/shared/domain/ids'

// fallow-ignore-next-line unused-type
export type GetPortalGroupDeps = Readonly<{
  portalGroupRepo: PortalGroupRepository
}>

export const getPortalGroup =
  (deps: GetPortalGroupDeps) =>
  async (input: { portalGroupId: string }, ctx: AuthContext): Promise<PortalGroup> => {
    if (!can(ctx.role, 'portal.read')) {
      throw portalError('forbidden', 'No portal read permission')
    }

    const gid = portalGroupId(input.portalGroupId)
    const group = await deps.portalGroupRepo.findById(ctx.organizationId, gid)
    if (!group) {
      throw portalError('group_not_found', 'portal group not found in this organization')
    }
    return group
  }

// fallow-ignore-next-line unused-type
export type GetPortalGroup = ReturnType<typeof getPortalGroup>
