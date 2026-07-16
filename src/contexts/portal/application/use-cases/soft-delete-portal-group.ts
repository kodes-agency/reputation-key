// Portal context — soft delete portal group use case
// Full pattern: authorize → find → soft delete → emit → return

import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { portalError } from '../../domain/errors'
import { portalGroupDeleted } from '../../domain/events'
import type { EventBus } from '#/shared/events/event-bus'
import { portalGroupId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPropertyAccess } from '../assert-property-access'
import { emitAndRecord, type OutboxRepository } from '#/shared/outbox'

// fallow-ignore-next-line unused-type
export type SoftDeletePortalGroupDeps = Readonly<{
  portalGroupRepo: PortalGroupRepository
  staffPublicApi: StaffPublicApi
  events: EventBus
  clock: () => Date
  outboxRepo?: OutboxRepository
}>

export const softDeletePortalGroup =
  (deps: SoftDeletePortalGroupDeps) =>
  async (input: { portalGroupId: string }, ctx: AuthContext): Promise<void> => {
    if (!canForContext(ctx, 'portal.delete')) {
      throw portalError('forbidden', 'this role cannot delete portal groups')
    }

    const gid = portalGroupId(input.portalGroupId)
    const existing = await deps.portalGroupRepo.findById(ctx.organizationId, gid)
    if (!existing) {
      throw portalError('group_not_found', 'portal group not found in this organization')
    }
    // Enforce property-assignment scoping (D6-001.)
    await assertPropertyAccess(
      deps.staffPublicApi,
      ctx,
      'portal.delete',
      existing.propertyId,
    )

    await deps.portalGroupRepo.softDelete(ctx.organizationId, gid)

    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
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
