// Portal context — add portal to group use case
// Full pattern: authorize → find group → check not already grouped → atomically add with fact → return

import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PortalRepository } from '../ports/portal.repository'
import { portalError } from '../../domain/errors'
import { portalAddedToGroup } from '../../domain/events'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { loadGroupAndPortalForMembership } from '../load-accessible-portal'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import { nextPortalCommandAt } from '../portal-command-version'

export type AddPortalToGroupDeps = Readonly<{
  portalGroupRepo: PortalGroupRepository
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
  commandStore: PortalCommandStore
  clock: () => Date
}>

export const addPortalToGroup =
  (deps: AddPortalToGroupDeps) =>
  async (
    input: { portalGroupId: string; portalId: string },
    ctx: AuthContext,
  ): Promise<void> => {
    const { gid, pid, group } = await loadGroupAndPortalForMembership(deps, ctx, input)

    // Verify the portal exists and belongs to the same property as the group.
    // This prevents cross-property grouping via a group from one property + portal from another.
    const portal = await deps.portalRepo.findById(ctx.organizationId, pid)
    if (!portal) {
      throw portalError('portal_not_found', 'portal not found in this organization')
    }
    if (String(portal.propertyId) !== String(group.propertyId)) {
      throw portalError(
        'forbidden',
        'portal must belong to the same property as the group',
      )
    }
    const existingGroupId = await deps.portalGroupRepo.findPortalMembership(
      ctx.organizationId,
      pid,
    )
    if (existingGroupId) {
      throw portalError('portal_already_grouped', 'portal is already in a group')
    }

    const occurredAt = deps.clock()
    const revision = nextPortalCommandAt(occurredAt, group.updatedAt)
    const event = portalAddedToGroup({
      portalGroupId: gid,
      portalId: pid,
      organizationId: ctx.organizationId,
      propertyId: group.propertyId,
      sourceAggregateVersion: revision.toISOString(),
      occurredAt,
    })
    await deps.commandStore.addPortalToGroup({
      organizationId: ctx.organizationId,
      propertyId: group.propertyId,
      portalGroupId: gid,
      portalId: pid,
      expectedUpdatedAt: group.updatedAt,
      revision,
      occurredAt,
      changedBy: ctx.userId,
      event,
    })
  }

export type AddPortalToGroup = ReturnType<typeof addPortalToGroup>
