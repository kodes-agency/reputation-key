// POST-BETA-2 PB2.1: Portal token lifecycle.
//
// Per ADR 0044: public URL uses a high-entropy random token. Token rotation
// supports a grace period for already-printed codes, explicit revocation
// for compromise, version/batch metadata, and audit.
//
// Lifecycle:  active -> rotating -> revoked
//                  \-> active (grace period)
//
// A token may be in a grace period where both old and new tokens resolve
// to the same portal. This supports already-printed QR codes.

export type TokenStatus = 'active' | 'rotating' | 'revoked'

export interface PortalToken {
  readonly id: string
  readonly organizationId: string
  readonly propertyId: string
  readonly portalId: string
  readonly tokenHash: string
  readonly version: number
  readonly printBatch: string | null
  readonly status: TokenStatus
  readonly issuedAt: Date
  readonly revokedAt: Date | null
  readonly gracePeriodEnds: Date | null
  readonly revokedBy: string | null
  readonly revokedReason: string | null
}

export type TokenError =
  | { code: 'token_not_active'; status: TokenStatus }
  | { code: 'already_revoked' }
  | { code: 'grace_period_expired' }
  | { code: 'invalid_status_transition'; from: TokenStatus; to: TokenStatus }

const VALID_TRANSITIONS: Readonly<Record<TokenStatus, readonly TokenStatus[]>> = {
  active: ['rotating', 'revoked'],
  rotating: ['active', 'revoked'],
  revoked: [],
}

export function isValidTransition(from: TokenStatus, to: TokenStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

export function isActive(token: PortalToken, asOf: Date): boolean {
  if (token.status === 'revoked') return false
  if (
    token.status === 'rotating' &&
    token.gracePeriodEnds &&
    asOf > token.gracePeriodEnds
  ) {
    return false
  }
  return true
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
  tokenHash: string
  version: number
  printBatch?: string
  now: Date
}): PortalToken {
  return {
    id: params.id,
    organizationId: params.organizationId,
    propertyId: params.propertyId,
    portalId: params.portalId,
    tokenHash: params.tokenHash,
    version: params.version,
    printBatch: params.printBatch ?? null,
    status: 'active',
    issuedAt: params.now,
    revokedAt: null,
    gracePeriodEnds: null,
    revokedBy: null,
    revokedReason: null,
  }
}

/**
 * Rotate a token. The old token enters a grace period during which
 * both old and new tokens resolve. After the grace period, only the
 * new token is valid.
 *
 * Per ADR 0044: rotation supports a grace period for already-printed codes.
 */
export function rotateToken(
  token: PortalToken,
  newTokenHash: string,
  newId: string,
  newVersion: number,
  gracePeriodDuration: number,
  now: Date,
): { oldToken: PortalToken; newToken: PortalToken } | TokenError {
  if (!isValidTransition(token.status, 'rotating')) {
    if (token.status === 'revoked') return { code: 'already_revoked' }
    return { code: 'invalid_status_transition', from: token.status, to: 'rotating' }
  }

  const graceEnd = new Date(now.getTime() + gracePeriodDuration)

  return {
    oldToken: {
      ...token,
      status: 'rotating',
      gracePeriodEnds: graceEnd,
    },
    newToken: issueToken({
      id: newId,
      organizationId: token.organizationId,
      propertyId: token.propertyId,
      portalId: token.portalId,
      tokenHash: newTokenHash,
      version: newVersion,
      now,
    }),
  }
}

/**
 * Revoke a token immediately. No grace period — this is for compromise.
 */
export function revokeToken(
  token: PortalToken,
  revokedBy: string,
  reason: string,
  now: Date,
): PortalToken | TokenError {
  if (token.status === 'revoked') {
    return { code: 'already_revoked' }
  }

  return {
    ...token,
    status: 'revoked',
    revokedAt: now,
    revokedBy,
    revokedReason: reason,
  }
}

/**
 * Check if a token is within its grace period (still resolves alongside
 * a newer token).
 */
export function isInGracePeriod(token: PortalToken, asOf: Date): boolean {
  return (
    token.status === 'rotating' &&
    token.gracePeriodEnds !== null &&
    asOf <= token.gracePeriodEnds
  )
}
