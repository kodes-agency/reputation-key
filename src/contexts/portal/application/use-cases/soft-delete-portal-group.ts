// Portal context — soft delete portal group use case
// Full pattern: authorize → find → atomically archive + record fact → return

import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { portalError } from '../../domain/errors'
import { portalGroupDeleted } from '../../domain/events'
import { portalGroupId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPropertyAccess } from '../assert-property-access'

export type SoftDeletePortalGroupDeps = Readonly<{
  portalGroupRepo: PortalGroupRepository
  commandStore: Pick<PortalCommandStore, 'deletePortalGroup'>
  staffPublicApi: StaffPublicApi
  clock: () => Date
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

    const now = deps.clock()
    const event = portalGroupDeleted({
      portalGroupId: gid,
      organizationId: ctx.organizationId,
      propertyId: existing.propertyId,
      occurredAt: now,
    })
    await deps.commandStore.deletePortalGroup({
      organizationId: ctx.organizationId,
      propertyId: existing.propertyId,
      portalGroupId: gid,
      expectedUpdatedAt: existing.updatedAt,
      at: now,
      event,
    })
  }

export type SoftDeletePortalGroup = ReturnType<typeof softDeletePortalGroup>
