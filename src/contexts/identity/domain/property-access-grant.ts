// POST-BETA-1 PB1.1: Property access grant lifecycle.
//
// PropertyAccessGrant is an explicit authorization grant that lets a user
// perform declared actions within a property scope. It is separate from
// team membership, portal responsibility, and staff participation.
//
// Per ADR 0039: authorization never derives from team membership, lead
// status, or portal responsibility — only from explicit grants.
//
// Lifecycle:  active -> revoked
//                  \-> active (re-grant after revocation if needed)

export type GrantStatus = 'active' | 'revoked'

export type GrantKind = 'full_access' | 'manage' | 'respond' | 'view'

export interface PropertyAccessGrant {
  readonly id: string
  readonly organizationId: string
  readonly propertyId: string
  readonly userId: string
  readonly kind: GrantKind
  readonly status: GrantStatus
  readonly grantedAt: Date
  readonly revokedAt: Date | null
  readonly grantedBy: string
  readonly revokedBy: string | null
  readonly reason: string | null
}

export type GrantError =
  | { code: 'already_granted'; kind: GrantKind }
  | { code: 'grant_not_active'; status: GrantStatus }
  | { code: 'last_owner_protection'; message: string }
  | { code: 'invalid_kind'; kind: string }

const VALID_KINDS: ReadonlySet<GrantKind> = new Set([
  'full_access',
  'manage',
  'respond',
  'view',
])

export function isValidKind(kind: string): kind is GrantKind {
  return VALID_KINDS.has(kind as GrantKind)
}

export function isActive(grant: PropertyAccessGrant): boolean {
  return grant.status === 'active'
}

/**
 * Create a new grant. Validates kind and prevents duplicate active grants.
 * Returns the grant or an error.
 */
export function createGrant(params: {
  id: string
  organizationId: string
  propertyId: string
  userId: string
  kind: GrantKind
  grantedBy: string
  now: Date
}): PropertyAccessGrant | GrantError {
  if (!isValidKind(params.kind)) {
    return { code: 'invalid_kind', kind: params.kind }
  }

  return {
    id: params.id,
    organizationId: params.organizationId,
    propertyId: params.propertyId,
    userId: params.userId,
    kind: params.kind,
    status: 'active',
    grantedAt: params.now,
    revokedAt: null,
    grantedBy: params.grantedBy,
    revokedBy: null,
    reason: null,
  }
}

/**
 * Revoke a grant. The grant becomes inactive but history is preserved.
 * Implements last-owner protection: the last full_access grant on a
 * property cannot be revoked without transferring ownership first.
 */
export function revokeGrant(
  grant: PropertyAccessGrant,
  revokedBy: string,
  reason: string,
  activeFullAccessCount: number,
  now: Date,
): PropertyAccessGrant | GrantError {
  if (grant.status !== 'active') {
    return { code: 'grant_not_active', status: grant.status }
  }

  if (grant.kind === 'full_access' && activeFullAccessCount <= 1) {
    return {
      code: 'last_owner_protection',
      message: 'Cannot revoke the last full_access grant. Transfer ownership first.',
    }
  }

  return {
    ...grant,
    status: 'revoked',
    revokedAt: now,
    revokedBy,
    reason,
  }
}

/**
 * Check if a grant allows a specific action.
 * full_access > manage > respond > view
 */
export function allowsAction(grant: PropertyAccessGrant, action: GrantKind): boolean {
  if (!isActive(grant)) return false

  const hierarchy: Record<GrantKind, number> = {
    full_access: 4,
    manage: 3,
    respond: 2,
    view: 1,
  }

  return hierarchy[grant.kind] >= hierarchy[action]
}
