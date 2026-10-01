// Portal context — get portal group use case
// Per architecture: simple query use case — authorize, find, return.

import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { PortalGroup } from '../../domain/types'
import type { PortalId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { loadReadableGroup } from '../load-accessible-portal'

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
    const group = await loadReadableGroup(deps, ctx, input.portalGroupId)
    return {
      ...group,
      portalIds: await deps.portalGroupRepo.getGroupPortalIds(
        ctx.organizationId,
        group.id,
      ),
    }
  }

export type GetPortalGroup = ReturnType<typeof getPortalGroup>
