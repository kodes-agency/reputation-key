// Portal context — remove portal from group use case
// Full pattern: authorize → find group → remove → emit → return

import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { portalError } from '../../domain/errors'
import { portalRemovedFromGroup } from '../../domain/events'
import type { EventBus } from '#/shared/events/event-bus'
import { portalGroupId, portalId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPropertyAccess } from '../assert-property-access'

// fallow-ignore-next-line unused-type
export type RemovePortalFromGroupDeps = Readonly<{
  portalGroupRepo: PortalGroupRepository
  staffPublicApi: StaffPublicApi
  events: EventBus
  clock: () => Date
}>

export const removePortalFromGroup =
  (deps: RemovePortalFromGroupDeps) =>
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

    const removed = await deps.portalGroupRepo.removePortal(ctx.organizationId, gid, pid)
    if (!removed) {
      throw portalError('portal_not_in_group', 'portal is not a member of this group')
    }

    await deps.events.emit(
      portalRemovedFromGroup({
        portalGroupId: gid,
        portalId: pid,
        organizationId: ctx.organizationId,
        occurredAt: deps.clock(),
      }),
    )
  }

// fallow-ignore-next-line unused-type
export type RemovePortalFromGroup = ReturnType<typeof removePortalFromGroup>
