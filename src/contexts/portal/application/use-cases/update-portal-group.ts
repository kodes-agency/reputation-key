// Portal context — update portal group use case
import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PortalGroup } from '../../domain/portal-group-types'
import type { UpdatePortalGroupInput } from '../dto/portal-group.dto'
import { can } from '#/shared/domain/permissions'
import { portalError } from '../../domain/errors'
import { portalGroupUpdated } from '../../domain/portal-group-events'
import { portalGroupId } from '#/shared/domain/ids'

export type UpdatePortalGroupDeps = Readonly<{
  groupRepo: PortalGroupRepository
  events: EventBus
  clock: () => Date
}>

export const updatePortalGroup =
  (deps: UpdatePortalGroupDeps) =>
  async (input: UpdatePortalGroupInput, ctx: AuthContext): Promise<PortalGroup> => {
    if (!can(ctx.role, 'portal.manage')) {
      throw portalError('forbidden', 'Only managers can update portal groups')
    }

    const groupId = portalGroupId(input.groupId)
    const existing = await deps.groupRepo.findById(ctx.organizationId, groupId)
    if (!existing) {
      throw portalError('group_not_found', 'Portal group not found')
    }

    // Check name uniqueness (excluding self)
    const duplicate = await deps.groupRepo.findByNameDuplicate(
      ctx.organizationId,
      existing.propertyId,
      input.name,
      groupId,
    )
    if (duplicate) {
      throw portalError('group_name_taken', 'A group with this name already exists')
    }

    const updated: PortalGroup = {
      ...existing,
      name: input.name.trim(),
      updatedAt: deps.clock(),
    }

    const result = await deps.groupRepo.update(updated)

    await deps.events.emit(
      portalGroupUpdated({
        groupId: result.id,
        organizationId: result.organizationId,
        propertyId: result.propertyId,
        name: result.name,
        occurredAt: result.updatedAt,
      }),
    )

    return result
  }

export type UpdatePortalGroup = ReturnType<typeof updatePortalGroup>
