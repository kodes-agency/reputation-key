// Portal context — create portal group use case
// Full 7-step pattern: authorize → validate refs → check uniqueness → build → persist → emit → return

import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { PropertyPublicApi } from '#/contexts/property/application/public-api'
import type { EventBus } from '#/shared/events/event-bus'
import type { PortalGroup, PortalGroupId } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { CreatePortalGroupInput } from '../dto/create-portal-group.dto'
import { can } from '#/shared/domain/permissions'
import { buildPortalGroup } from '../../domain/constructors'
import { portalError } from '../../domain/errors'
import { portalGroupCreated, portalAddedToGroup } from '../../domain/events'
import { propertyId, portalId } from '#/shared/domain/ids'

// fallow-ignore-next-line unused-type
export type CreatePortalGroupDeps = Readonly<{
  portalGroupRepo: PortalGroupRepository
  propertyApi: PropertyPublicApi
  events: EventBus
  idGen: () => PortalGroupId
  clock: () => Date
}>

export const createPortalGroup =
  (deps: CreatePortalGroupDeps) =>
  async (input: CreatePortalGroupInput, ctx: AuthContext): Promise<PortalGroup> => {
    // 1. Authorize
    if (!can(ctx.role, 'portal.create')) {
      throw portalError('forbidden', 'this role cannot create portal groups')
    }

    // 2. Validate referenced property exists
    if (
      !(await deps.propertyApi.propertyExists(
        ctx.organizationId,
        propertyId(input.propertyId),
      ))
    ) {
      throw portalError('property_not_found', 'property not found in this organization')
    }

    // 3. Check uniqueness — group name must be unique per org+property
    if (
      await deps.portalGroupRepo.nameExists(
        ctx.organizationId,
        propertyId(input.propertyId),
        input.name,
      )
    ) {
      throw portalError('group_name_taken', 'a group with this name already exists')
    }

    // 4. Build domain object
    const groupResult = buildPortalGroup({
      id: deps.idGen(),
      organizationId: ctx.organizationId,
      propertyId: propertyId(input.propertyId),
      name: input.name,
      now: deps.clock(),
    })

    if (groupResult.isErr()) {
      throw groupResult.error
    }

    const group = groupResult.value

    // 5. Persist
    await deps.portalGroupRepo.insert(ctx.organizationId, group)

    // 6a. Emit created event
    await deps.events.emit(
      portalGroupCreated({
        portalGroupId: group.id,
        organizationId: group.organizationId,
        propertyId: group.propertyId,
        name: group.name,
        occurredAt: group.createdAt,
      }),
    )

    // 6b. Add portals if provided — pre-validate all before mutating
    if (input.portalIds?.length) {
      const brandedPids = input.portalIds.map((pid) => portalId(pid))
      for (const brandedPid of brandedPids) {
        const existing = await deps.portalGroupRepo.findPortalMembership(
          ctx.organizationId,
          brandedPid,
        )
        if (existing) {
          throw portalError(
            'portal_already_grouped',
            `portal ${brandedPid} is already in a group`,
          )
        }
      }
      for (const brandedPid of brandedPids) {
        await deps.portalGroupRepo.addPortal(ctx.organizationId, group.id, brandedPid)
        await deps.events.emit(
          portalAddedToGroup({
            portalGroupId: group.id,
            portalId: brandedPid,
            organizationId: ctx.organizationId,
            occurredAt: deps.clock(),
          }),
        )
      }
    }

    // 7. Return
    return group
  }

// fallow-ignore-next-line unused-type
export type CreatePortalGroup = ReturnType<typeof createPortalGroup>
