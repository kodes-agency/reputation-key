// Portal context — soft delete portal use case

import type { PortalRepository } from '../ports/portal.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { can } from '#/shared/domain/permissions'
import { portalId as toPortalId } from '#/shared/domain/ids'
import { portalError } from '../../domain/errors'
import { portalDeleted } from '../../domain/events'
import type { EventBus } from '#/shared/events/event-bus'

// fallow-ignore-next-line unused-type
export type SoftDeletePortalDeps = Readonly<{
  portalRepo: PortalRepository
  events: EventBus
  clock: () => Date
}>

export const softDeletePortal =
  (deps: SoftDeletePortalDeps) =>
  async (input: { portalId: string }, ctx: AuthContext): Promise<void> => {
    if (!can(ctx.role, 'portal.delete')) {
      throw portalError('forbidden', 'this role cannot delete portals')
    }

    const pid = toPortalId(input.portalId)
    const existing = await deps.portalRepo.findById(ctx.organizationId, pid)
    if (!existing) {
      throw portalError('portal_not_found', 'portal not found in this organization')
    }

    await deps.portalRepo.softDelete(ctx.organizationId, pid)

    deps.events.emit(
      portalDeleted({
        portalId: pid,
        organizationId: ctx.organizationId,
        occurredAt: deps.clock(),
      }),
    )
  }

// fallow-ignore-next-line unused-type
export type SoftDeletePortal = ReturnType<typeof softDeletePortal>
