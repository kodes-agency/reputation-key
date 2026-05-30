// Portal context — list portal groups use case
import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PortalGroup } from '../../domain/types'
import type { ListPortalGroupsInput } from '../dto/portal-group.dto'
import { can } from '#/shared/domain/permissions'
import { portalError } from '../../domain/errors'
import { propertyId as toPropertyId } from '#/shared/domain/ids'

export type ListPortalGroupsDeps = Readonly<{
  groupRepo: PortalGroupRepository
}>

export const listPortalGroups =
  (deps: ListPortalGroupsDeps) =>
  async (
    input: ListPortalGroupsInput,
    ctx: AuthContext,
  ): Promise<ReadonlyArray<PortalGroup>> => {
    if (!can(ctx.role, 'portal.read')) {
      throw portalError('forbidden', 'No portal read permission')
    }
    return deps.groupRepo.listByProperty(
      ctx.organizationId,
      toPropertyId(input.propertyId),
    )
  }

export type ListPortalGroups = ReturnType<typeof listPortalGroups>
