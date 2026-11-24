// POST-BETA-2 PB2.1: Portal token lifecycle.
//
// Per ADR 0044: public URL uses a high-entropy random token. Token rotation
// supports a grace period for already-printed codes; revocation is a
// command-store write.
//
// Lifecycle:  active -> rotating -> revoked
//
// A token may be in a grace period where both old and new tokens resolve
// to the same portal. This supports already-printed QR codes.

export type TokenStatus = 'active' | 'rotating' | 'revoked'

export interface PortalToken {
  readonly id: string
  readonly organizationId: string
  readonly propertyId: string
  readonly portalId: string
  readonly tokenIdentifier: string
  readonly tokenHash: string
  readonly tokenKeyVersion: number
  readonly version: number
  readonly status: TokenStatus
  readonly issuedAt: Date
  readonly gracePeriodEnds: Date | null
  readonly retiredAt: Date | null
  readonly revokedAt: Date | null
  readonly revokedBy: string | null
  readonly revokedReason: string | null
}

/**
 * Issue a new token. The token hash is stored, not the raw token.
 * Callers should generate a high-entropy random token, hash it, and
 * store only the hash.
 */
export function issueToken(params: {
  id: string
  organizationId: string
  propertyId: string
  portalId: string
  tokenIdentifier: string
  tokenHash: string
  tokenKeyVersion: number
  version: number
  now: Date
}): PortalToken {
  return {
    id: params.id,
    organizationId: params.organizationId,
    propertyId: params.propertyId,
    portalId: params.portalId,
    tokenIdentifier: params.tokenIdentifier,
    tokenHash: params.tokenHash,
    tokenKeyVersion: params.tokenKeyVersion,
    version: params.version,
    status: 'active',
    issuedAt: params.now,
    gracePeriodEnds: null,
    retiredAt: null,
    revokedAt: null,
    revokedBy: null,
    revokedReason: null,
  }
}

/**
 * Rotate an active token. The old token enters a grace period during which
 * both old and new tokens resolve. After the grace period, only the
 * new token is valid.
 *
 * Per ADR 0044: rotation supports a grace period for already-printed codes.
 */
export function rotateToken(
  token: PortalToken,
  replacement: Readonly<{
    id: string
    tokenIdentifier: string
    tokenHash: string
    tokenKeyVersion: number
    version: number
  }>,
  gracePeriodDuration: number,
  now: Date,
): { oldToken: PortalToken & { gracePeriodEnds: Date }; newToken: PortalToken } {
  if (token.status !== 'active') {
    throw new Error(`Only an active portal token can be rotated, not ${token.status}`)
  }

  const graceEnd = new Date(now.getTime() + gracePeriodDuration)

  return {
    oldToken: {
      ...token,
      status: 'rotating',
      gracePeriodEnds: graceEnd,
      retiredAt: graceEnd,
    },
    newToken: issueToken({
      id: replacement.id,
      organizationId: token.organizationId,
      propertyId: token.propertyId,
      portalId: token.portalId,
      tokenIdentifier: replacement.tokenIdentifier,
      tokenHash: replacement.tokenHash,
      tokenKeyVersion: replacement.tokenKeyVersion,
      version: replacement.version,
      now,
    }),
  }
}
