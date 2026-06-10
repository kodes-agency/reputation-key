// Portal context — add portal to group use case
// Full pattern: authorize → find group → check not already grouped → add → emit → return

import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { can } from '#/shared/domain/permissions'
import { portalError } from '../../domain/errors'
import { portalAddedToGroup } from '../../domain/events'
import type { EventBus } from '#/shared/events/event-bus'
import { portalGroupId, portalId } from '#/shared/domain/ids'

// fallow-ignore-next-line unused-type
export type AddPortalToGroupDeps = Readonly<{
  portalGroupRepo: PortalGroupRepository
  events: EventBus
  clock: () => Date
}>

export const addPortalToGroup =
  (deps: AddPortalToGroupDeps) =>
  async (
    input: { portalGroupId: string; portalId: string },
    ctx: AuthContext,
  ): Promise<void> => {
    if (!can(ctx.role, 'portal.update')) {
      throw portalError('forbidden', 'this role cannot manage portal group membership')
    }

    const gid = portalGroupId(input.portalGroupId)
    const pid = portalId(input.portalId)

    const group = await deps.portalGroupRepo.findById(ctx.organizationId, gid)
    if (!group) {
      throw portalError('group_not_found', 'portal group not found in this organization')
    }

    const existingGroupId = await deps.portalGroupRepo.findPortalMembership(
      ctx.organizationId,
      pid,
    )
    if (existingGroupId) {
      throw portalError('portal_already_grouped', 'portal is already in a group')
    }

    await deps.portalGroupRepo.addPortal(ctx.organizationId, gid, pid)

    await deps.events.emit(
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
