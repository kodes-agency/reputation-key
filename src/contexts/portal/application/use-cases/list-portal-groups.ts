// Portal context — list portal groups use case
// Per architecture: simple query use case — authorize, query, return.

import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { PortalGroup } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { can } from '#/shared/domain/permissions'
import { portalError } from '../../domain/errors'
import { propertyId } from '#/shared/domain/ids'

// fallow-ignore-next-line unused-type
export type ListPortalGroupsDeps = Readonly<{
  portalGroupRepo: PortalGroupRepository
}>

export const listPortalGroups =
  (deps: ListPortalGroupsDeps) =>
  async (
    input: { propertyId: string },
    ctx: AuthContext,
  ): Promise<ReadonlyArray<PortalGroup>> => {
    if (!can(ctx.role, 'portal.read')) {
      throw portalError('forbidden', 'No portal read permission')
    }
    return deps.portalGroupRepo.listByProperty(
      ctx.organizationId,
      propertyId(input.propertyId),
    )
  }

// fallow-ignore-next-line unused-type
export type ListPortalGroups = ReturnType<typeof listPortalGroups>
