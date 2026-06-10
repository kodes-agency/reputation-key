// Portal context — soft delete portal group use case
// Full pattern: authorize → find → soft delete → emit → return

import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { can } from '#/shared/domain/permissions'
import { portalError } from '../../domain/errors'
import { portalGroupDeleted } from '../../domain/events'
import type { EventBus } from '#/shared/events/event-bus'
import { portalGroupId } from '#/shared/domain/ids'

// fallow-ignore-next-line unused-type
export type SoftDeletePortalGroupDeps = Readonly<{
  portalGroupRepo: PortalGroupRepository
  events: EventBus
  clock: () => Date
}>

export const softDeletePortalGroup =
  (deps: SoftDeletePortalGroupDeps) =>
  async (input: { portalGroupId: string }, ctx: AuthContext): Promise<void> => {
    if (!can(ctx.role, 'portal.delete')) {
      throw portalError('forbidden', 'this role cannot delete portal groups')
    }

    const gid = portalGroupId(input.portalGroupId)
    const existing = await deps.portalGroupRepo.findById(ctx.organizationId, gid)
    if (!existing) {
      throw portalError('group_not_found', 'portal group not found in this organization')
    }

    await deps.portalGroupRepo.softDelete(ctx.organizationId, gid)

    await deps.events.emit(
      portalGroupDeleted({
        portalGroupId: gid,
        organizationId: ctx.organizationId,
        propertyId: existing.propertyId,
        occurredAt: deps.clock(),
      }),
    )
  }

// fallow-ignore-next-line unused-type
export type SoftDeletePortalGroup = ReturnType<typeof softDeletePortalGroup>
