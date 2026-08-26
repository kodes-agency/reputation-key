import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId } from '#/shared/domain/ids'
import type { PortalRepository } from '../ports/portal.repository'
import type { PortalTokenRepository } from '../ports/portal-token.repository'
import type { PortalTokenCodec } from '../ports/portal-token-codec.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { loadPortalOrThrow } from '../load-accessible-portal'
import { rotateToken } from '../../domain/portal-token'
import { portalError } from '../../domain/errors'
import { portalTokenRotated } from '../../domain/events'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import { nextPortalCommandAt } from '../portal-command-version'

const MAX_GRACE_SECONDS = 7 * 24 * 60 * 60

export type RotatePortalTokenDeps = Readonly<{
  portalRepo: PortalRepository
  portalTokenRepo: PortalTokenRepository
  tokenCodec: PortalTokenCodec
  staffPublicApi: StaffPublicApi
  commandStore: PortalCommandStore
  idGen: () => string
  clock: () => Date
  baseUrl: string
  defaultGracePeriodSeconds: number
}>

export const rotatePortalToken =
  (deps: RotatePortalTokenDeps) =>
  async (
    input: Readonly<{ portalId: string; gracePeriodSeconds?: number }>,
    ctx: AuthContext,
  ): Promise<
    Readonly<{
      rawToken: string
      publicUrl: string
      tokenIdentifier: string
      version: number
      gracePeriodEnds: Date
    }>
  > => {
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.update',
      forbiddenMessage: 'Insufficient permissions to rotate portal tokens',
    })
    const graceSeconds = input.gracePeriodSeconds ?? deps.defaultGracePeriodSeconds
    if (
      !Number.isInteger(graceSeconds) ||
      graceSeconds < 0 ||
      graceSeconds > MAX_GRACE_SECONDS
    ) {
      throw portalError(
        'token_unavailable',
        'Token grace period must be between 0 and 7 days',
      )
    }
    const current = await deps.portalTokenRepo.findLatestForPortal(
      ctx.organizationId,
      portal.id,
    )
    if (!current || current.status !== 'active') {
      throw portalError('token_unavailable', 'No active portal token to rotate')
    }

    const material = deps.tokenCodec.issue()
    const now = nextPortalCommandAt(deps.clock(), portal.updatedAt)
    const result = rotateToken(
      current,
      {
        id: deps.idGen(),
        tokenIdentifier: material.tokenIdentifier,
        tokenHash: material.tokenHash,
        tokenKeyVersion: material.tokenKeyVersion,
        version: current.version + 1,
      },
      graceSeconds * 1000,
      now,
    )
    if (!('oldToken' in result)) {
      throw portalError('token_unavailable', 'Portal token cannot be rotated')
    }
    const gracePeriodEnds = result.oldToken.gracePeriodEnds
    if (!gracePeriodEnds) {
      throw portalError('token_unavailable', 'Portal token rotation has no grace period')
    }
    const event = portalTokenRotated({
      portalId: portal.id,
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      previousVersion: current.version,
      version: result.newToken.version,
      gracePeriodEnds,
      sourceAggregateVersion: now.toISOString(),
      occurredAt: now,
    })
    await deps.commandStore.rotatePortalToken({
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      expectedPortalUpdatedAt: portal.updatedAt,
      oldToken: result.oldToken,
      newToken: result.newToken,
      at: now,
      event,
    })
    return {
      rawToken: material.rawToken,
      publicUrl: new URL(`/p/${material.rawToken}`, deps.baseUrl).toString(),
      tokenIdentifier: result.newToken.tokenIdentifier,
      version: result.newToken.version,
      gracePeriodEnds,
    }
  }

export type RotatePortalToken = ReturnType<typeof rotatePortalToken>
