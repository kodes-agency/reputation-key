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
}>

export const NO_ACTIVE_TOKEN: PortalTokenStatus = {
  hasActiveToken: false,
  qualifiedScanReady: false,
  version: null,
  issuedAt: null,
  graceExpiresAt: null,
}

export const toPortalTokenStatus = (
  summary: ResolvablePortalTokenSummary | null | undefined,
): PortalTokenStatus =>
  summary
    ? {
        hasActiveToken: true,
        qualifiedScanReady: summary.hasPublishedAccessArtifact,
        version: summary.version,
        issuedAt: summary.issuedAt.toISOString(),
        graceExpiresAt: summary.gracePeriodEnds?.toISOString() ?? null,
      }
    : NO_ACTIVE_TOKEN
