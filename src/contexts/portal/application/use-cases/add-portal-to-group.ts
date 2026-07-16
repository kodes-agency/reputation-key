// Portal context — add portal to group use case
// Full pattern: authorize → find group → check not already grouped → add → emit → return

import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PortalRepository } from '../ports/portal.repository'
import { canForContext } from '#/shared/domain/permissions'
import { portalError } from '../../domain/errors'
import { portalAddedToGroup } from '../../domain/events'
import type { EventBus } from '#/shared/events/event-bus'
import { portalGroupId, portalId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPropertyAccess } from '../assert-property-access'
import { emitAndRecord, type OutboxRepository } from '#/shared/outbox'

// fallow-ignore-next-line unused-type
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
    if (!canForContext(ctx, 'portal.update')) {
      throw portalError('forbidden', 'this role cannot manage portal group membership')
    }

    const gid = portalGroupId(input.portalGroupId)
    const pid = portalId(input.portalId)

    const group = await deps.portalGroupRepo.findById(ctx.organizationId, gid)
    if (!group) {
      throw portalError('group_not_found', 'portal group not found in this organization')
    }
    // Enforce property-assignment scoping (D6-001.)
    await assertPropertyAccess(
      deps.staffPublicApi,
      ctx,
      'portal.update',
      group.propertyId,
    )

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

    await deps.portalGroupRepo.addPortal(ctx.organizationId, gid, pid)

    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
      portalAddedToGroup({
        portalGroupId: gid,
        portalId: pid,
        organizationId: ctx.organizationId,
        occurredAt: deps.clock(),
      }),
    )
  }

// fallow-ignore-next-line unused-type
export type AddPortalToGroup = ReturnType<typeof addPortalToGroup>
