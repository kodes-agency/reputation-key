// Portal context — create portal group use case
import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PortalGroup } from '../../domain/types'
import type { CreatePortalGroupInput } from '../dto/portal-group.dto'
import { can } from '#/shared/domain/permissions'
import { buildPortalGroup } from '../../domain/constructors'
import { portalError } from '../../domain/errors'
import { portalGroupCreated } from '../../domain/events'
import { portalGroupId, propertyId as toPropertyId } from '#/shared/domain/ids'

export type CreatePortalGroupDeps = Readonly<{
  groupRepo: PortalGroupRepository
  events: EventBus
  idGen: () => string
  clock: () => Date
}>

export const createPortalGroup =
  (deps: CreatePortalGroupDeps) =>
  async (input: CreatePortalGroupInput, ctx: AuthContext): Promise<PortalGroup> => {
    if (!can(ctx.role, 'portal.create')) {
      throw portalError('forbidden', 'Only managers can create portal groups')
    }

    const propertyId = toPropertyId(input.propertyId)

    // Check name uniqueness
    const existing = await deps.groupRepo.findByNameDuplicate(
      ctx.organizationId,
      propertyId,
      input.name,
    )
    if (existing) {
      throw portalError('group_name_taken', 'A group with this name already exists')
    }

    const buildResult = buildPortalGroup({
      id: portalGroupId(deps.idGen()),
      organizationId: ctx.organizationId,
      propertyId,
      name: input.name,
      now: deps.clock(),
    })

    if (buildResult.isErr()) {
      throw buildResult.error
    }

    const group = buildResult.value
    await deps.groupRepo.insert(group)

    await deps.events.emit(
      portalGroupCreated({
        groupId: group.id,
        organizationId: group.organizationId,
        propertyId: group.propertyId,
        name: group.name,
        occurredAt: group.createdAt,
      }),
    )

    return group
  }

export type CreatePortalGroup = ReturnType<typeof createPortalGroup>
