// Portal context — update portal group use case
// Full 7-step pattern: authorize → find → check uniqueness → update → emit → return

import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { PortalGroup } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { UpdatePortalGroupInput } from '../dto/update-portal-group.dto'
import { can } from '#/shared/domain/permissions'
import { portalError } from '../../domain/errors'
import { portalGroupUpdated } from '../../domain/events'
import { portalGroupId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPropertyAccess } from '../assert-property-access'

// fallow-ignore-next-line unused-type
export type UpdatePortalGroupDeps = Readonly<{
  portalGroupRepo: PortalGroupRepository
  staffPublicApi: StaffPublicApi
  events: EventBus
  clock: () => Date
}>

export const updatePortalGroup =
  (deps: UpdatePortalGroupDeps) =>
  async (input: UpdatePortalGroupInput, ctx: AuthContext): Promise<PortalGroup> => {
    // 1. Authorize
    if (!can(ctx.role, 'portal.update')) {
      throw portalError('forbidden', 'this role cannot update portal groups')
    }

    // 2. Find existing
    const gid = portalGroupId(input.portalGroupId)
    const existing = await deps.portalGroupRepo.findById(ctx.organizationId, gid)
    if (!existing) {
      throw portalError('group_not_found', 'portal group not found in this organization')
    }
    // Enforce property-assignment scoping (D6-001.)
    await assertPropertyAccess(deps.staffPublicApi, ctx, existing.propertyId)

    // 3. Check name uniqueness if name is changing
    const newName = input.name ?? existing.name
    if (newName !== existing.name) {
      if (
        await deps.portalGroupRepo.nameExists(
          ctx.organizationId,
          existing.propertyId,
          newName,
          gid,
        )
      ) {
        throw portalError('group_name_taken', 'a group with this name already exists')
      }
    }

    // 4. Update
    const now = deps.clock()
    await deps.portalGroupRepo.update(ctx.organizationId, gid, {
      name: newName,
      updatedAt: now,
    })

    // 5. Emit event
    await deps.events.emit(
      portalGroupUpdated({
        portalGroupId: gid,
        organizationId: ctx.organizationId,
        propertyId: existing.propertyId,
        name: newName,
        occurredAt: now,
      }),
    )

    // 6. Return updated group
    return { ...existing, name: newName, updatedAt: now }
  }

// fallow-ignore-next-line unused-type
export type UpdatePortalGroup = ReturnType<typeof updatePortalGroup>
