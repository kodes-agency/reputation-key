// Portal context — list portal group history use case
// Per architecture: simple query use case — authorize, find, read, return.

import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { PortalGroupHistoryRepository } from '../ports/portal-group-history.repository'
import type { PortalGroupHistoryEntry } from '../../domain/portal-group-history'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { loadReadableGroup } from '../load-accessible-portal'

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
    const group = await loadReadableGroup(deps, ctx, input.portalGroupId)
    return deps.portalGroupHistoryRepo.listForGroup(
      ctx.organizationId,
      group.id,
      PORTAL_GROUP_HISTORY_PAGE,
    )
  }

export type ListPortalGroupHistory = ReturnType<typeof listPortalGroupHistory>
