// Portal context — remove portal from group use case
// Full pattern: authorize → find group → remove → emit → return

import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalError } from '../../domain/errors'
import { portalRemovedFromGroup } from '../../domain/events'
import type { EventBus } from '#/shared/events/event-bus'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { loadGroupAndPortalForMembership } from '../load-accessible-portal'
import { emitAndRecord, type OutboxRepository } from '#/shared/outbox'

export type RemovePortalFromGroupDeps = Readonly<{
  portalGroupRepo: PortalGroupRepository
  staffPublicApi: StaffPublicApi
  events: EventBus
  clock: () => Date
  outboxRepo?: OutboxRepository
}>

export const removePortalFromGroup =
  (deps: RemovePortalFromGroupDeps) =>
  async (
    input: { portalGroupId: string; portalId: string },
    ctx: AuthContext,
  ): Promise<void> => {
    const { gid, pid } = await loadGroupAndPortalForMembership(deps, ctx, input)

    const now = deps.clock()
    const removed = await deps.portalGroupRepo.removePortal(
      ctx.organizationId,
      gid,
      pid,
      now,
      'removed_from_group',
    )
    if (!removed) {
      throw portalError('portal_not_in_group', 'portal is not a member of this group')
    }

    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
      portalRemovedFromGroup({
        portalGroupId: gid,
        portalId: pid,
        organizationId: ctx.organizationId,
        occurredAt: now,
      }),
    )
  }

export type RemovePortalFromGroup = ReturnType<typeof removePortalFromGroup>
