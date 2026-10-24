import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId } from '#/shared/domain/ids'
import type { PortalRepository } from '../ports/portal.repository'
import type { PortalTokenRepository } from '../ports/portal-token.repository'
import type { PortalTokenCodec } from '../ports/portal-token-codec.port'
import type { PortalAddressCipher } from '../ports/portal-address-cipher.port'
import type { PrintCodeReporter } from '../ports/print-code-reporter.port'
import {
  portalPublicUrls,
  type PortalAddressFormat,
  type PortalPublicUrls,
} from '../portal-address-urls'
import {
  derivePrintCodesForNewCode,
  printCodeHashesOf,
  printCodesOf,
  reportingPrintCodeCollision,
} from '../print-code-lifecycle'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { loadPortalOrThrow } from '../load-accessible-portal'
import { publishNewCodeArtifacts } from '../new-code-artifacts'
import { rotateToken } from '../../domain/portal-token'
import { portalError } from '../../domain/errors'
import { portalTokenRotated } from '../../domain/events'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import { nextPortalCommandAt } from '../portal-command-version'

const SECONDS_PER_DAY = 24 * 60 * 60
const MAX_PLANNED_GRACE_DAYS = 90

export type RotatePortalTokenDeps = Readonly<{
  portalRepo: PortalRepository
  portalTokenRepo: PortalTokenRepository
  tokenCodec: PortalTokenCodec
  /** Null when no keyring is configured: the address is then shown once (ADR 0064). */
  addressCipher: PortalAddressCipher | null
  staffPublicApi: StaffPublicApi
  commandStore: PortalCommandStore
  reportPrintCodeProblem: PrintCodeReporter
  idGen: () => string
  clock: () => Date
  address: PortalAddressFormat
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
      publicUrls: PortalPublicUrls
      tokenIdentifier: string
      version: number
      gracePeriodEnds: Date
      /** The new address was sealed, so a manager can download it again (ADR 0064). */
      addressRecoverable: boolean
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
    const sealedAddress =
      deps.addressCipher?.seal(material.rawToken, {
        organizationId: result.newToken.organizationId,
        propertyId: result.newToken.propertyId,
        portalId: result.newToken.portalId,
        tokenId: result.newToken.id,
        version: result.newToken.version,
      }) ?? null
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
    const { accessArtifacts, accessArtifactEvents, artifactIds } =
      publishNewCodeArtifacts({
        portal,
        portalTokenId: result.newToken.id,
        idGen: deps.idGen,
        occurredAt,
        revision,
      })
    const printCodes = derivePrintCodesForNewCode(deps.tokenCodec, {
      rawToken: material.rawToken,
      accessArtifactIds: artifactIds,
    })
    await reportingPrintCodeCollision(deps.reportPrintCodeProblem, () =>
      deps.commandStore.rotatePortalToken({
        organizationId: ctx.organizationId,
        propertyId: portal.propertyId,
        portalId: portal.id,
        expectedPortalUpdatedAt: portal.updatedAt,
        oldToken: result.oldToken,
        newToken: result.newToken,
        // fallow-ignore-next-line code-duplication
        issuedBy: ctx.userId,
        sealedAddress,
        printCodeHashes: printCodeHashesOf(printCodes),
        accessArtifacts,
        revision,
        occurredAt,
        event,
        accessArtifactEvents,
      }),
    )
    const publicUrls = portalPublicUrls(deps.address, {
      rawToken: material.rawToken,
      artifacts: artifactIds,
      printCodes: printCodesOf(printCodes),
    })
    return {
      rawToken: material.rawToken,
      publicUrl: publicUrls.qr,
      publicUrls,
      tokenIdentifier: result.newToken.tokenIdentifier,
      version: result.newToken.version,
      gracePeriodEnds,
      addressRecoverable: sealedAddress !== null,
    }
  }

export type RotatePortalToken = ReturnType<typeof rotatePortalToken>
