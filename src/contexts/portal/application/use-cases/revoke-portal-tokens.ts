import type { AuthContext } from '#/shared/domain/auth-context'
import type { EventBus } from '#/shared/events/event-bus'
import { emitAndRecord, type OutboxRepository } from '#/shared/outbox'
import { portalId, unbrand } from '#/shared/domain/ids'
import type { PortalRepository } from '../ports/portal.repository'
import type { PortalTokenRepository } from '../ports/portal-token.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { loadPortalOrThrow } from '../load-accessible-portal'
import { portalError } from '../../domain/errors'
import { portalTokenRevoked } from '../../domain/events'

export type RevokePortalTokensDeps = Readonly<{
  portalRepo: PortalRepository
  portalTokenRepo: PortalTokenRepository
  staffPublicApi: StaffPublicApi
  events: EventBus
  outboxRepo?: OutboxRepository
  clock: () => Date
}>

export const revokePortalTokens =
  (deps: RevokePortalTokensDeps) =>
  async (
    input: Readonly<{ portalId: string; reason: string }>,
    ctx: AuthContext,
  ): Promise<Readonly<{ revoked: number }>> => {
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.update',
      forbiddenMessage: 'Insufficient permissions to revoke portal tokens',
    })
    const reason = input.reason.trim()
    if (!reason) throw portalError('token_unavailable', 'Revocation reason is required')
    const at = deps.clock()
    const revoked = await deps.portalTokenRepo.revokeForPortal({
      organizationId: ctx.organizationId,
      portalId: portal.id,
      revokedBy: unbrand(ctx.userId),
      reason,
      at,
    })
    if (revoked > 0) {
      await emitAndRecord(
        deps.events,
        deps.outboxRepo,
        portalTokenRevoked({
          portalId: portal.id,
          organizationId: portal.organizationId,
          propertyId: portal.propertyId,
          occurredAt: at,
        }),
      )
    }
    return { revoked }
  }

export type RevokePortalTokens = ReturnType<typeof revokePortalTokens>
