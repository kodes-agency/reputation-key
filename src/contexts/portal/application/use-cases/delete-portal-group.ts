// Portal context — delete portal group use case
import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { DeletePortalGroupInput } from '../dto/portal-group.dto'
export type { DeletePortalGroupInput }
import { can } from '#/shared/domain/permissions'
import { portalError } from '../../domain/errors'
import { portalGroupDeleted } from '../../domain/events'
import { portalGroupId } from '#/shared/domain/ids'

export type DeletePortalGroupDeps = Readonly<{
  groupRepo: PortalGroupRepository
  events: EventBus
  clock: () => Date
}>

export const deletePortalGroup =
  (deps: DeletePortalGroupDeps) =>
  async (input: DeletePortalGroupInput, ctx: AuthContext): Promise<void> => {
    if (!can(ctx.role, 'portal.delete')) {
      throw portalError('forbidden', 'Only managers can delete portal groups')
    }

    const groupId = portalGroupId(input.groupId)
    const existing = await deps.groupRepo.findById(ctx.organizationId, groupId)
    if (!existing) {
      throw portalError('group_not_found', 'Portal group not found')
    }

    // Hard-delete
    await deps.groupRepo.delete(ctx.organizationId, groupId)

    await deps.events.emit(
      portalGroupDeleted({
        groupId,
        organizationId: existing.organizationId,
        propertyId: existing.propertyId,
        occurredAt: deps.clock(),
      }),
    )
  }

export type DeletePortalGroup = ReturnType<typeof deletePortalGroup>
