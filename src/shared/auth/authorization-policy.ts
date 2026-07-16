// AuthorizationPolicy — centralized authorization decisions for beta (B0.6 / BQR-4).
//
// Combines three layers into a single authorize() call:
//   1. Beta capability check (is the feature enabled for this org?)
//   2. Role-based permission check (does the user's role allow this action?)
//   3. Property-scope validation (can the user access this specific property?)
//
// This is the single entry point for authorization in server functions and
// use cases. Contexts should not branch on role strings or duplicate logic.
//
// ADR 0033 formalizes this as the authoritative authorization interface.

import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import { canForContext, scopeForPermission } from '#/shared/domain/permissions'
import type { DataScope } from '#/shared/domain/data-scope'
import { checkBetaCapability, type Capability } from '#/shared/auth/beta-capabilities'
import { throwContextError } from '#/shared/auth/server-errors'

export type AuthorizationDecision = Readonly<{
  allowed: boolean
  reason: 'allowed' | 'capability_denied' | 'permission_denied' | 'scope_denied'
}>

export type AuthorizeInput = Readonly<{
  /** The authenticated user's context. */
  actor: AuthContext
  /** The permission required for this action (e.g., 'property.create'). */
  action: Permission
  /** The beta capability for this action (e.g., 'property.create'). */
  capability: Capability
  /** If set, validate that the user has scope access to this property. */
  propertyId?: string
  /** Set of property IDs the user is assigned to (for scope checking). */
  assignedPropertyIds?: ReadonlySet<string>
}>

/**
 * Authorize an action. Checks capability, permission, and property scope.
 *
 * Returns a decision object. Use `authorize()` for the throwing variant.
 */
export function checkAuthorization(input: AuthorizeInput): AuthorizationDecision {
  const { actor, action, capability, propertyId, assignedPropertyIds } = input

  // Layer 1: Beta capability — is the feature enabled for this org?
  const capDecision = checkBetaCapability(actor, capability, propertyId)
  if (!capDecision.allowed) {
    return { allowed: false, reason: 'capability_denied' }
  }

  // Layer 2: Role-based permission — does the user's role allow this?
  if (!canForContext(actor, action)) {
    return { allowed: false, reason: 'permission_denied' }
  }

  // Layer 3: Property-scope validation (if property-scoped)
  if (propertyId) {
    const scope = scopeForPermission(actor, action)
    if (scope === 'none') {
      return { allowed: false, reason: 'scope_denied' }
    }
    // 'organization' scope = user can access any property in their org
    if (scope === 'assigned-properties' && assignedPropertyIds) {
      if (!assignedPropertyIds.has(propertyId)) {
        return { allowed: false, reason: 'scope_denied' }
      }
    }
  }

  return { allowed: true, reason: 'allowed' }
}

/**
 * Assert authorization. Throws AuthorizationError if denied.
 */
export function authorize(input: AuthorizeInput): void {
  const decision = checkAuthorization(input)
  if (!decision.allowed) {
    throw new AuthorizationError(decision)
  }
}

/**
 * Map a permission to the beta surface capability that must be enabled (BQR-4.1).
 * Dark-context permissions map to dark capabilities (fail closed unless allowlisted).
 */
export function capabilityForPermission(permission: Permission): Capability {
  switch (permission) {
    case 'property.create':
      return 'property.create'
    case 'property.update':
    case 'property.delete':
    case 'property.read':
    case 'property.admin':
      return 'property.create'
    case 'reply.manage':
      return 'property.publish_reply'
    case 'review.read':
      return 'review.use'
    case 'inbox.read':
    case 'inbox.write':
    case 'inbox.manage':
      return 'inbox.use'
    case 'dashboard.read':
    case 'dashboard.fleet_read':
      return 'dashboard.use'
    case 'staff_assignment.create':
    case 'staff_assignment.delete':
    case 'staff_assignment.read':
      return 'staff.use'
    case 'integration.manage':
      return 'integration.use'
    case 'notification.read':
    case 'notification.update':
      return 'notification.in_app'
    case 'invitation.create':
    case 'invitation.list':
    case 'invitation.cancel':
    case 'invitation.resend':
      return 'identity.invite'
    case 'portal.create':
    case 'portal.update':
    case 'portal.delete':
    case 'portal.read':
      return 'portal.read'
    case 'team.create':
    case 'team.update':
    case 'team.delete':
    case 'team.read':
      return 'team.use'
    case 'goal.read':
    case 'goal.create':
    case 'goal.update':
    case 'goal.cancel':
      return 'goal.use'
    case 'badge.read':
    case 'badge.manage':
      return 'badge.use'
    case 'leaderboard.read':
      return 'leaderboard.use'
    case 'organization.update':
    case 'organization.delete':
    case 'member.create':
    case 'member.update':
    case 'member.delete':
    case 'member.list':
    case 'identity.avatar_upload':
    case 'identity.logo_upload':
    case 'identity.password.change':
    case 'identity.profile.update':
    case 'identity.avatar.set':
    case 'identity.leave_org':
    case 'ac.create':
    case 'ac.read':
    case 'ac.update':
    case 'ac.delete':
    case 'feedback.read':
    case 'feedback.respond':
      return 'identity.invite'
    default: {
      const _exhaustive: never = permission
      return _exhaustive
    }
  }
}

/**
 * Server-function helper: authorize capability + permission (+ optional scope)
 * and throw a serializable AuthError on deny (BQR-4.1).
 */
export function requireAuthorized(
  input: Omit<AuthorizeInput, 'capability'> & { capability?: Capability },
): void {
  const capability = input.capability ?? capabilityForPermission(input.action)
  try {
    authorize({ ...input, capability })
  } catch (e) {
    if (e instanceof AuthorizationError) {
      throwContextError(
        'AuthError',
        {
          code: e.decision.reason,
          message: `Authorization denied: ${e.decision.reason}`,
        },
        403,
      )
    }
    throw e
  }
}

export class AuthorizationError extends Error {
  constructor(public readonly decision: AuthorizationDecision) {
    super(`Authorization denied: ${decision.reason}`)
    this.name = 'AuthorizationError'
  }
}

export { type DataScope }
