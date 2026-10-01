// Portal context — list portal group history use case
// Per architecture: simple query use case — authorize, find, read, return.

import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { PortalGroupHistoryRepository } from '../ports/portal-group-history.repository'
import type { PortalGroupHistoryEntry } from '../../domain/portal-group-history'
import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { portalGroupId } from '#/shared/domain/ids'
import { portalError } from '../../domain/errors'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { assertPropertyAccess } from '../assert-property-access'

export const PORTAL_GROUP_HISTORY_PAGE = 100

export type ListPortalGroupHistoryDeps = Readonly<{
  portalGroupRepo: PortalGroupRepository
  portalGroupHistoryRepo: PortalGroupHistoryRepository
  staffPublicApi: StaffPublicApi
}>

export const listPortalGroupHistory =
  (deps: ListPortalGroupHistoryDeps) =>
  async (
    input: { portalGroupId: string },
    ctx: AuthContext,
  ): Promise<ReadonlyArray<PortalGroupHistoryEntry>> => {
    if (!canForContext(ctx, 'portal.read')) {
      throw portalError('forbidden', 'No portal read permission')
    }
    const gid = portalGroupId(input.portalGroupId)
    const group = await deps.portalGroupRepo.findById(ctx.organizationId, gid)
    if (!group) {
      throw portalError('group_not_found', 'portal group not found in this organization')
    }
    await assertPropertyAccess(deps.staffPublicApi, ctx, 'portal.read', group.propertyId)
    return deps.portalGroupHistoryRepo.listForGroup(
      ctx.organizationId,
      gid,
      PORTAL_GROUP_HISTORY_PAGE,
    )
  }

export type ListPortalGroupHistory = ReturnType<typeof listPortalGroupHistory>
