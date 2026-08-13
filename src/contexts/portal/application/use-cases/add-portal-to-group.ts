// Portal context — add portal to group use case
// Full pattern: authorize → find group → check not already grouped → add → emit → return

import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PortalRepository } from '../ports/portal.repository'
import { portalError } from '../../domain/errors'
import { portalAddedToGroup } from '../../domain/events'
import type { EventBus } from '#/shared/events/event-bus'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { loadGroupAndPortalForMembership } from '../load-accessible-portal'
import { emitAndRecord, type OutboxRepository } from '#/shared/outbox'

export type AddPortalToGroupDeps = Readonly<{
  portalGroupRepo: PortalGroupRepository
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
  events: EventBus
  clock: () => Date
  outboxRepo?: OutboxRepository
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

    const now = deps.clock()
    await deps.portalGroupRepo.addPortal(ctx.organizationId, gid, pid, now, ctx.userId)

    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
      portalAddedToGroup({
        portalGroupId: gid,
        portalId: pid,
        organizationId: ctx.organizationId,
        occurredAt: now,
      }),
    )
  }

export type AddPortalToGroup = ReturnType<typeof addPortalToGroup>
