import type { AuthContext } from '#/shared/domain/auth-context'
import { portalAccessArtifactId, unbrand, portalId } from '#/shared/domain/ids'
import type { PortalRepository } from '../ports/portal.repository'
import type { PortalTokenRepository } from '../ports/portal-token.repository'
import type { PortalTokenCodec } from '../ports/portal-token-codec.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { loadPortalOrThrow } from '../load-accessible-portal'
import { issueToken } from '../../domain/portal-token'
import { portalError } from '../../domain/errors'
import { portalAccessArtifactPublished, portalTokenIssued } from '../../domain/events'
import { publishPortalAccessArtifact } from '../../domain/portal-access-artifact'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import { nextPortalCommandAt } from '../portal-command-version'

export type IssuePortalTokenDeps = Readonly<{
  portalRepo: PortalRepository
  portalTokenRepo: PortalTokenRepository
  tokenCodec: PortalTokenCodec
  staffPublicApi: StaffPublicApi
  commandStore: PortalCommandStore
  idGen: () => string
  clock: () => Date
  baseUrl: string
}>

export type IssuedPortalTokenResult = Readonly<{
  rawToken: string
  publicUrl: string
  publicUrls: Readonly<{ qr: string; nfc: string }>
  tokenIdentifier: string
  version: number
  issuedAt: Date
}>

export const issuePortalToken =
  (deps: IssuePortalTokenDeps) =>
  async (
    input: Readonly<{ portalId: string }>,
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
    const occurredAt = deps.clock()
    const revision = nextPortalCommandAt(occurredAt, portal.updatedAt)
    const token = issueToken({
      id: deps.idGen(),
      organizationId: unbrand(portal.organizationId),
      propertyId: unbrand(portal.propertyId),
      portalId: unbrand(portal.id),
      tokenIdentifier: material.tokenIdentifier,
      tokenHash: material.tokenHash,
      tokenKeyVersion: material.tokenKeyVersion,
      version: (latest?.version ?? 0) + 1,
      now: occurredAt,
    })
    const event = portalTokenIssued({
      portalId: portal.id,
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      tokenIdentifier: token.tokenIdentifier,
      version: token.version,
      sourceAggregateVersion: revision.toISOString(),
      occurredAt: token.issuedAt,
    })
    const qrArtifact = publishPortalAccessArtifact({
      id: portalAccessArtifactId(deps.idGen()),
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      portalTokenId: token.id,
      channel: 'qr',
      now: occurredAt,
    })
    const nfcArtifact = publishPortalAccessArtifact({
      id: portalAccessArtifactId(deps.idGen()),
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      portalTokenId: token.id,
      channel: 'nfc',
      now: occurredAt,
    })
    const accessArtifacts = [qrArtifact, nfcArtifact] as const
    const eventFor = (artifact: (typeof accessArtifacts)[number]) =>
      portalAccessArtifactPublished({
        accessArtifactId: artifact.id,
        portalId: portal.id,
        organizationId: portal.organizationId,
        propertyId: portal.propertyId,
        channel: artifact.channel,
        sourceAggregateVersion: revision.toISOString(),
        occurredAt,
      })
    const accessArtifactEvents = [eventFor(qrArtifact), eventFor(nfcArtifact)] as const
    await deps.commandStore.issuePortalToken({
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      expectedPortalUpdatedAt: portal.updatedAt,
      token,
      accessArtifacts,
      revision,
      occurredAt,
      event,
      accessArtifactEvents,
    })
    const publicUrlFor = (artifact: (typeof accessArtifacts)[number]) => {
      const url = new URL(`/p/${material.rawToken}`, deps.baseUrl)
      url.searchParams.set('accessArtifact', artifact.id)
      return url.toString()
    }
    const publicUrls = {
      qr: publicUrlFor(qrArtifact),
      nfc: publicUrlFor(nfcArtifact),
    }
    return {
      rawToken: material.rawToken,
      publicUrl: publicUrls.qr,
      publicUrls,
      tokenIdentifier: token.tokenIdentifier,
      version: token.version,
      issuedAt: token.issuedAt,
    }
  }

export type IssuePortalToken = ReturnType<typeof issuePortalToken>
