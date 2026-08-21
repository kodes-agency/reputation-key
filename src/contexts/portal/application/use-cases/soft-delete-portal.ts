// Portal context — soft delete portal use case

import type { PortalRepository } from '../ports/portal.repository'
import type { PortalTokenRepository } from '../ports/portal-token.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { portalId as toPortalId, unbrand } from '#/shared/domain/ids'
import { portalError } from '../../domain/errors'
import { portalDeleted, portalTokenRevoked } from '../../domain/events'
import type { EventBus } from '#/shared/events/event-bus'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPropertyAccess } from '../assert-property-access'
import { emitAndRecord, type OutboxRepository } from '#/shared/outbox'

export type SoftDeletePortalInput = Readonly<{
  portalId: string
}>

export type SoftDeletePortalDeps = Readonly<{
  portalRepo: PortalRepository
  portalTokenRepo: PortalTokenRepository
  staffPublicApi: StaffPublicApi
  events: EventBus
  clock: () => Date
  outboxRepo?: OutboxRepository
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
    await deps.portalRepo.softDelete(ctx.organizationId, pid)

    // A deleted portal must not keep live tokens. Until now the only thing denying
    // guest access was the read-time publication gate in loadPublicPortal, so a
    // regression there would have resurrected every dormant printed QR code.
    // Idempotent: revokeForPortal only touches rows still active/rotating, so a repeated
    // delete (or a portal that never had a token) revokes 0 and emits nothing.
    const revoked = await deps.portalTokenRepo.revokeForPortal({
      organizationId: ctx.organizationId,
      portalId: pid,
      revokedBy: unbrand(ctx.userId),
      reason: DELETION_REVOCATION_REASON,
      at: occurredAt,
    })
    if (revoked > 0) {
      await emitAndRecord(
        deps.events,
        deps.outboxRepo,
        portalTokenRevoked({
          portalId: pid,
          organizationId: ctx.organizationId,
          propertyId: existing.propertyId,
          occurredAt,
        }),
      )
    }

    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
      portalDeleted({
        portalId: pid,
        organizationId: ctx.organizationId,
        occurredAt,
      }),
    )
  }

export type SoftDeletePortal = ReturnType<typeof softDeletePortal>
