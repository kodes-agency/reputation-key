// Portal context — soft delete portal use case

import type { PortalRepository } from '../ports/portal.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { portalId as toPortalId } from '#/shared/domain/ids'
import { portalError } from '../../domain/errors'
import { portalDeleted } from '../../domain/events'
import type { EventBus } from '#/shared/events/event-bus'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPropertyAccess } from '../assert-property-access'

// fallow-ignore-next-line unused-type
export type SoftDeletePortalInput = Readonly<{
  portalId: string
}>

// fallow-ignore-next-line unused-type
export type SoftDeletePortalDeps = Readonly<{
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
  events: EventBus
  clock: () => Date
}>

export const softDeletePortal =
  (deps: SoftDeletePortalDeps) =>
  async (input: SoftDeletePortalInput, ctx: AuthContext): Promise<void> => {
    if (!canForContext(ctx, 'portal.delete')) {
      throw portalError('forbidden', 'this role cannot delete portals')
    }

    const pid = toPortalId(input.portalId)
    const existing = await deps.portalRepo.findById(ctx.organizationId, pid)
    if (!existing) {
      throw portalError('portal_not_found', 'portal not found in this organization')
    }
    // Enforce property-assignment scoping (D6-001.)
    await assertPropertyAccess(
      deps.staffPublicApi,
      ctx,
      'portal.delete',
      existing.propertyId,
    )

    await deps.portalRepo.softDelete(ctx.organizationId, pid)

    await deps.events.emit(
      portalDeleted({
        portalId: pid,
        organizationId: ctx.organizationId,
        occurredAt: deps.clock(),
      }),
    )
  }

// fallow-ignore-next-line unused-type
export type SoftDeletePortal = ReturnType<typeof softDeletePortal>
