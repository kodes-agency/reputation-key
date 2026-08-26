// Portal context — soft delete portal use case

import type { PortalRepository } from '../ports/portal.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { portalId as toPortalId } from '#/shared/domain/ids'
import { portalError } from '../../domain/errors'
import { portalDeleted, portalTokenRevoked } from '../../domain/events'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPropertyAccess } from '../assert-property-access'
import type { PortalCommandStore } from '../ports/portal-command-store.port'

export type SoftDeletePortalInput = Readonly<{
  portalId: string
}>

export type SoftDeletePortalDeps = Readonly<{
  portalRepo: PortalRepository
  commandStore: PortalCommandStore
  staffPublicApi: StaffPublicApi
  clock: () => Date
}>

/** Audit reason stamped on tokens revoked as a side effect of portal deletion. */
const DELETION_REVOCATION_REASON = 'portal deleted'

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

    const occurredAt = deps.clock()
    await deps.commandStore.deletePortal({
      organizationId: ctx.organizationId,
      propertyId: existing.propertyId,
      portalId: pid,
      expectedUpdatedAt: existing.updatedAt,
      revokedBy: ctx.userId,
      reason: DELETION_REVOCATION_REASON,
      at: occurredAt,
      event: portalDeleted({
        portalId: pid,
        organizationId: ctx.organizationId,
        propertyId: existing.propertyId,
        sourceAggregateVersion: occurredAt.toISOString(),
        occurredAt,
      }),
      tokenRevokedEvent: portalTokenRevoked({
        portalId: pid,
        organizationId: ctx.organizationId,
        propertyId: existing.propertyId,
        sourceAggregateVersion: occurredAt.toISOString(),
        occurredAt,
      }),
    })
  }

export type SoftDeletePortal = ReturnType<typeof softDeletePortal>
