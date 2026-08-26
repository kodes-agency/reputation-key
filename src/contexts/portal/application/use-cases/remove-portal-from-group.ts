// Portal context — remove portal from group use case
// Full pattern: authorize → find group → remove → emit → return

import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalRemovedFromGroup } from '../../domain/events'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { loadGroupAndPortalForMembership } from '../load-accessible-portal'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import { nextPortalCommandAt } from '../portal-command-version'

export type RemovePortalFromGroupDeps = Readonly<{
  portalGroupRepo: PortalGroupRepository
  staffPublicApi: StaffPublicApi
  commandStore: PortalCommandStore
  clock: () => Date
}>

export const removePortalFromGroup =
  (deps: RemovePortalFromGroupDeps) =>
  async (
    input: { portalGroupId: string; portalId: string },
    ctx: AuthContext,
  ): Promise<void> => {
    const { gid, pid, group } = await loadGroupAndPortalForMembership(deps, ctx, input)

    const now = nextPortalCommandAt(deps.clock(), group.updatedAt)
    const event = portalRemovedFromGroup({
      portalGroupId: gid,
      portalId: pid,
      organizationId: ctx.organizationId,
      propertyId: group.propertyId,
      sourceAggregateVersion: now.toISOString(),
      occurredAt: now,
    })
    await deps.commandStore.removePortalFromGroup({
      organizationId: ctx.organizationId,
      propertyId: group.propertyId,
      portalGroupId: gid,
      portalId: pid,
      expectedUpdatedAt: group.updatedAt,
      at: now,
      changedBy: ctx.userId,
      event,
    })
  }

export type RemovePortalFromGroup = ReturnType<typeof removePortalFromGroup>
