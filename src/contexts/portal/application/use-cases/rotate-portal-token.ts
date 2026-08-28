import type { AuthContext } from '#/shared/domain/auth-context'
import { portalAccessArtifactId, portalId } from '#/shared/domain/ids'
import type { PortalRepository } from '../ports/portal.repository'
import type { PortalTokenRepository } from '../ports/portal-token.repository'
import type { PortalTokenCodec } from '../ports/portal-token-codec.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { loadPortalOrThrow } from '../load-accessible-portal'
import { rotateToken } from '../../domain/portal-token'
import { portalError } from '../../domain/errors'
import { portalAccessArtifactPublished, portalTokenRotated } from '../../domain/events'
import { publishPortalAccessArtifact } from '../../domain/portal-access-artifact'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import { nextPortalCommandAt } from '../portal-command-version'

const SECONDS_PER_DAY = 24 * 60 * 60
const MAX_PLANNED_GRACE_DAYS = 90

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
    input: Readonly<{
      portalId: string
      replacementKind?: 'planned' | 'security'
      gracePeriodDays?: number
    }>,
    ctx: AuthContext,
  ): Promise<
    Readonly<{
      rawToken: string
      publicUrl: string
      publicUrls: Readonly<{ qr: string; nfc: string }>
      tokenIdentifier: string
      version: number
      gracePeriodEnds: Date
    }>
  > => {
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.update',
      forbiddenMessage: 'Insufficient permissions to rotate portal tokens',
    })
    const replacementKind = input.replacementKind ?? 'planned'
    if (replacementKind === 'security' && input.gracePeriodDays !== undefined) {
      throw portalError(
        'token_unavailable',
        'Immediate security replacement cannot include a grace period',
      )
    }
    const defaultGraceDays = deps.defaultGracePeriodSeconds / SECONDS_PER_DAY
    const graceDays = input.gracePeriodDays ?? defaultGraceDays
    if (
      replacementKind === 'planned' &&
      (!Number.isInteger(graceDays) ||
        graceDays < 1 ||
        graceDays > MAX_PLANNED_GRACE_DAYS)
    ) {
      throw portalError(
        'token_unavailable',
        'Planned replacement must keep existing printed links for 1 to 90 days',
      )
    }
    const graceSeconds = replacementKind === 'security' ? 0 : graceDays * SECONDS_PER_DAY
    const current = await deps.portalTokenRepo.findLatestForPortal(
      ctx.organizationId,
      portal.id,
    )
    if (!current || current.status !== 'active') {
      throw portalError('token_unavailable', 'No active portal token to rotate')
    }

    const material = deps.tokenCodec.issue()
    const occurredAt = deps.clock()
    const revision = nextPortalCommandAt(occurredAt, portal.updatedAt)
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
      occurredAt,
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
      sourceAggregateVersion: revision.toISOString(),
      occurredAt,
    })
    const qrArtifact = publishPortalAccessArtifact({
      id: portalAccessArtifactId(deps.idGen()),
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      portalTokenId: result.newToken.id,
      channel: 'qr',
      now: occurredAt,
    })
    const nfcArtifact = publishPortalAccessArtifact({
      id: portalAccessArtifactId(deps.idGen()),
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      portalTokenId: result.newToken.id,
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
    await deps.commandStore.rotatePortalToken({
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      expectedPortalUpdatedAt: portal.updatedAt,
      oldToken: result.oldToken,
      newToken: result.newToken,
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
      tokenIdentifier: result.newToken.tokenIdentifier,
      version: result.newToken.version,
      gracePeriodEnds,
    }
  }

export type RotatePortalToken = ReturnType<typeof rotatePortalToken>
