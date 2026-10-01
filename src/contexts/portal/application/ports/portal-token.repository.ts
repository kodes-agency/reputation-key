import type { PortalToken } from '../../domain/portal-token'
import type { OrganizationId, PortalId } from '#/shared/domain/ids'

/**
 * Metadata-only projection of a portal's live token.
 *
 * PB2.1 / ADR 0044: deliberately carries no `tokenIdentifier` / `tokenHash` —
 * the raw token (and its digest) is only ever produced by issue/rotate, so the
 * token-status read path cannot leak material usable to reach a portal.
 */
export type ResolvablePortalTokenSummary = Readonly<{
  version: number
  issuedAt: Date
  gracePeriodEnds: Date | null
  /** Exact current address has a published QR/NFC marker eligible for scan goals. */
  hasPublishedAccessArtifact: boolean
  /**
   * The key version that sealed this code's address, or null when it holds none
   * (a code made before the keyring, or with no keyring configured). A version
   * only: the ciphertext never leaves `PortalAddressRepository`.
   */
  addressKeyVersion: number | null
}>

export type PortalAccessArtifactReadinessGap = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  tokenVersion: number
  tokenStatus: 'active' | 'rotating'
  issuedAt: Date
  gracePeriodEnds: Date | null
}>

export type PortalTokenRepository = Readonly<{
  findLatestForPortal: (
    organizationId: OrganizationId,
    portalId: PortalId,
  ) => Promise<PortalToken | null>
  /**
   * Newest token for the portal that still resolves as of `asOf` — active, or
   * rotating and inside its printed-code grace window. Shares one predicate
   * with `findResolvableByDigest` so the management view and public token
   * resolution cannot disagree about whether a portal has a live token.
   */
  findResolvableSummaryForPortal: (
    organizationId: OrganizationId,
    portalId: PortalId,
    asOf: Date,
  ) => Promise<ResolvablePortalTokenSummary | null>
  /**
   * `findResolvableSummaryForPortal` for a set of Portals in one read, with the
   * same predicate and the same "newest version governs" rule. A Portal with no
   * live token is absent.
   */
  findResolvableSummariesForPortals: (
    organizationId: OrganizationId,
    portalIds: readonly PortalId[],
    asOf: Date,
  ) => Promise<
    readonly (ResolvablePortalTokenSummary & Readonly<{ portalId: PortalId }>)[]
  >
  findResolvableByDigest: (
    digest: Readonly<{
      tokenIdentifier: string
      tokenHash: string
      tokenKeyVersion: number
    }>,
    asOf: Date,
  ) => Promise<PortalToken | null>
  /** Content-free inventory of currently reachable legacy addresses. */
  listAccessArtifactReadinessGaps: (
    asOf: Date,
    organizationIds?: readonly string[],
  ) => Promise<readonly PortalAccessArtifactReadinessGap[]>
  insert: (token: PortalToken) => Promise<void>
  saveRotation: (
    input: Readonly<{
      oldToken: PortalToken
      newToken: PortalToken
    }>,
  ) => Promise<void>
  revokeForPortal: (
    input: Readonly<{
      organizationId: OrganizationId
      portalId: PortalId
      revokedBy: string
      reason: string
      at: Date
    }>,
  ) => Promise<number>
}>
