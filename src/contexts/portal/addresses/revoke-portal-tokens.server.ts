import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId } from '#/shared/domain/ids'
import type { PortalRepository } from '../publication/portal-repository.port.server'
import type { PortalTokenRepository } from './portal-token-repository.port.server'
import type { StaffPublicApi } from '#/contexts/identity/public-api'
import { loadPortalOrThrow } from '../publication/load-accessible-portal.server'
import { portalTokenRevoked } from '../domain/events'
import type { PortalCommandStore } from '../publication/portal-command-store-port.server'
import { nextPortalCommandAt } from '../publication/portal-command-version.server'

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
      reason: input.reason,
      revision,
      occurredAt,
      event,
    })
  }
