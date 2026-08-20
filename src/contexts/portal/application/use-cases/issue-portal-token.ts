import type { AuthContext } from '#/shared/domain/auth-context'
import type { EventBus } from '#/shared/events/event-bus'
import { emitAndRecord, type OutboxRepository } from '#/shared/outbox'
import { unbrand, portalId } from '#/shared/domain/ids'
import type { PortalRepository } from '../ports/portal.repository'
import type { PortalTokenRepository } from '../ports/portal-token.repository'
import type { PortalTokenCodec } from '../ports/portal-token-codec.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { loadPortalOrThrow } from '../load-accessible-portal'
import { issueToken } from '../../domain/portal-token'
import { portalError } from '../../domain/errors'
import { portalTokenIssued } from '../../domain/events'

export type IssuePortalTokenDeps = Readonly<{
  portalRepo: PortalRepository
  portalTokenRepo: PortalTokenRepository
  tokenCodec: PortalTokenCodec
  staffPublicApi: StaffPublicApi
  events: EventBus
  outboxRepo?: OutboxRepository
  idGen: () => string
  clock: () => Date
  baseUrl: string
}>

export type IssuedPortalTokenResult = Readonly<{
  rawToken: string
  publicUrl: string
  tokenIdentifier: string
  version: number
  issuedAt: Date
}>

export const issuePortalToken =
  (deps: IssuePortalTokenDeps) =>
  async (
    input: Readonly<{ portalId: string; printBatch?: string }>,
    ctx: AuthContext,
  ): Promise<IssuedPortalTokenResult> => {
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.update',
      forbiddenMessage: 'Insufficient permissions to issue portal tokens',
    })
    const latest = await deps.portalTokenRepo.findLatestForPortal(
      ctx.organizationId,
      portal.id,
    )
    if (latest && latest.status !== 'revoked') {
      throw portalError('token_unavailable', 'Rotate the active portal token instead')
    }

    const material = deps.tokenCodec.issue()
    const token = issueToken({
      id: deps.idGen(),
      organizationId: unbrand(portal.organizationId),
      propertyId: unbrand(portal.propertyId),
      portalId: unbrand(portal.id),
      tokenIdentifier: material.tokenIdentifier,
      tokenHash: material.tokenHash,
      tokenKeyVersion: material.tokenKeyVersion,
      version: (latest?.version ?? 0) + 1,
      printBatch: input.printBatch,
      now: deps.clock(),
    })
    await deps.portalTokenRepo.insert(token)
    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
      portalTokenIssued({
        portalId: portal.id,
        organizationId: portal.organizationId,
        propertyId: portal.propertyId,
        tokenIdentifier: token.tokenIdentifier,
        version: token.version,
        occurredAt: token.issuedAt,
      }),
    )
    return {
      rawToken: material.rawToken,
      publicUrl: new URL(`/p/${material.rawToken}`, deps.baseUrl).toString(),
      tokenIdentifier: token.tokenIdentifier,
      version: token.version,
      issuedAt: token.issuedAt,
    }
  }

export type IssuePortalToken = ReturnType<typeof issuePortalToken>
