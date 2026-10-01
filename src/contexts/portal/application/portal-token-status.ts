// Portal context — the token status a management read shows for a Portal.
//
// One projection, shared by the single-Portal read (`getPortal`) and the batched
// overview (`listPortalOverview`), so the two cannot word the same token
// differently.

import type { ResolvablePortalTokenSummary } from './ports/portal-token.repository'

/**
 * PB2.1 / ADR 0044: whether the portal currently has a reachable public token,
 * plus the metadata the Share tab needs to label it. Existence only — never the
 * raw token or its digest, which issue/rotate alone return. Without this the
 * client cannot know a live token exists after a reload and so cannot offer
 * rotate/revoke, the only mitigations for a leaked opaque token.
 */
export type PortalTokenStatus = Readonly<{
  hasActiveToken: boolean
  /** False means the live legacy address must be rotated/reprinted for scan goals. */
  qualifiedScanReady: boolean
  version: number | null
  issuedAt: string | null
  graceExpiresAt: string | null
  /**
   * The live code's address can be downloaded again: it was sealed, and the
   * keyring still holds the key that sealed it (ADR 0062). While false the
   * address is shown once, when a code is made or replaced.
   */
  addressRecoverable: boolean
}>

export const NO_ACTIVE_TOKEN: PortalTokenStatus = {
  hasActiveToken: false,
  qualifiedScanReady: false,
  version: null,
  issuedAt: null,
  graceExpiresAt: null,
  addressRecoverable: false,
}

/** Whether a key version can open a sealed address: the cipher's `canOpen`, or never. */
export type CanOpenAddressKey = (keyVersion: number) => boolean

export const toPortalTokenStatus = (
  summary: ResolvablePortalTokenSummary | null | undefined,
  canOpenKey: CanOpenAddressKey = () => false,
): PortalTokenStatus =>
  summary
    ? {
        hasActiveToken: true,
        qualifiedScanReady: summary.hasPublishedAccessArtifact,
        version: summary.version,
        issuedAt: summary.issuedAt.toISOString(),
        graceExpiresAt: summary.gracePeriodEnds?.toISOString() ?? null,
        addressRecoverable:
          summary.addressKeyVersion !== null &&
          summary.hasPublishedAccessArtifact &&
          canOpenKey(summary.addressKeyVersion),
      }
    : NO_ACTIVE_TOKEN
