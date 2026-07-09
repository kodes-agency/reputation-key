// Portal context — create portal group use case
// Full 7-step pattern: authorize → validate refs → check uniqueness → build → persist → emit → return

import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { PortalRepository } from '../ports/portal.repository'
import type { PropertyPublicApi } from '#/contexts/property/application/public-api'
import type { EventBus } from '#/shared/events/event-bus'
import type { PortalGroup, PortalGroupId } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { CreatePortalGroupInput } from '../dto/create-portal-group.dto'
import { canForContext } from '#/shared/domain/permissions'
import { buildPortalGroup } from '../../domain/constructors'
import { portalError } from '../../domain/errors'
import { portalGroupCreated, portalAddedToGroup } from '../../domain/events'
import { propertyId, portalId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPropertyAccess } from '../assert-property-access'

// fallow-ignore-next-line unused-type
export type CreatePortalGroupDeps = Readonly<{
  portalGroupRepo: PortalGroupRepository
  portalRepo: PortalRepository
  propertyApi: PropertyPublicApi
  staffPublicApi: StaffPublicApi
  events: EventBus
  idGen: () => PortalGroupId
  clock: () => Date
}>

export const createPortalGroup =
  (deps: CreatePortalGroupDeps) =>
  async (input: CreatePortalGroupInput, ctx: AuthContext): Promise<PortalGroup> => {
    // 1. Authorize
    if (!canForContext(ctx, 'portal.create')) {
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
    // Enforce property-assignment scoping for PropertyManager (D6-001.)
    await assertPropertyAccess(
      deps.staffPublicApi,
      ctx,
      'portal.create',
      propertyId(input.propertyId),
    )

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
        // Verify the portal exists and belongs to the same property as the group.
        const portal = await deps.portalRepo.findById(ctx.organizationId, brandedPid)
        if (!portal) {
          throw portalError('portal_not_found', `portal ${brandedPid} not found`)
        }
        if (String(portal.propertyId) !== String(group.propertyId)) {
          throw portalError(
            'forbidden',
            `portal ${brandedPid} must belong to the same property as the group`,
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
