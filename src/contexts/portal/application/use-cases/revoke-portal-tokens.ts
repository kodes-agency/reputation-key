import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId } from '#/shared/domain/ids'
import type { PortalRepository } from '../ports/portal.repository'
import type { PortalTokenRepository } from '../ports/portal-token.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { loadPortalOrThrow } from '../load-accessible-portal'
import { portalError } from '../../domain/errors'
import { portalTokenRevoked } from '../../domain/events'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import { nextPortalCommandAt } from '../portal-command-version'

export type RevokePortalTokensDeps = Readonly<{
  portalRepo: PortalRepository
  portalTokenRepo: PortalTokenRepository
  staffPublicApi: StaffPublicApi
  commandStore: PortalCommandStore
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
    const occurredAt = deps.clock()
    const revision = nextPortalCommandAt(occurredAt, portal.updatedAt)
    const event = portalTokenRevoked({
      portalId: portal.id,
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      sourceAggregateVersion: revision.toISOString(),
      occurredAt,
    })
    return deps.commandStore.revokePortalTokens({
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      expectedPortalUpdatedAt: portal.updatedAt,
      revokedBy: ctx.userId,
      reason,
      revision,
      occurredAt,
      event,
    })
  }

export type RevokePortalTokens = ReturnType<typeof revokePortalTokens>
