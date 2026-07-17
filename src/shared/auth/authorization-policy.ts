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
const PERMISSION_CAPABILITY: Readonly<Record<Permission, Capability>> = {
  'property.create': 'property.create',
  'property.update': 'property.create',
  'property.delete': 'property.create',
  'property.read': 'property.create',
  'property.admin': 'property.create',
  'reply.manage': 'property.publish_reply',
  'review.read': 'review.use',
  'inbox.read': 'inbox.use',
  'inbox.write': 'inbox.use',
  'inbox.manage': 'inbox.use',
  'dashboard.read': 'dashboard.use',
  'dashboard.fleet_read': 'dashboard.use',
  'staff_assignment.create': 'staff.use',
  'staff_assignment.delete': 'staff.use',
  'staff_assignment.read': 'staff.use',
  'integration.manage': 'integration.use',
  'notification.read': 'notification.in_app',
  'notification.update': 'notification.in_app',
  'invitation.create': 'identity.invite',
  'invitation.list': 'identity.invite',
  'invitation.cancel': 'identity.invite',
  'invitation.resend': 'identity.invite',
  // BQC-0.2 / STD-P0-01: mutations and media are independent of portal.read.
  // portal.write and portal.upload remain hard-blocked for beta (ADR 0032).
  'portal.create': 'portal.write',
  'portal.update': 'portal.write',
  'portal.delete': 'portal.write',
  'portal.read': 'portal.read',
  'team.create': 'team.use',
  'team.update': 'team.use',
  'team.delete': 'team.use',
  'team.read': 'team.use',
  'goal.read': 'goal.use',
  'goal.create': 'goal.use',
  'goal.update': 'goal.use',
  'goal.cancel': 'goal.use',
  'badge.read': 'badge.use',
  'badge.manage': 'badge.use',
  'leaderboard.read': 'leaderboard.use',
  'organization.update': 'identity.invite',
  'organization.delete': 'identity.invite',
  'member.create': 'identity.invite',
  'member.update': 'identity.invite',
  'member.delete': 'identity.invite',
  'member.list': 'identity.invite',
  'identity.avatar_upload': 'identity.invite',
  'identity.logo_upload': 'identity.invite',
  'identity.password.change': 'identity.invite',
  'identity.profile.update': 'identity.invite',
  'identity.avatar.set': 'identity.invite',
  'identity.leave_org': 'identity.invite',
  'ac.create': 'identity.invite',
  'ac.read': 'identity.invite',
  'ac.update': 'identity.invite',
  'ac.delete': 'identity.invite',
  'feedback.read': 'identity.invite',
  'feedback.respond': 'identity.invite',
}

export function capabilityForPermission(permission: Permission): Capability {
  return PERMISSION_CAPABILITY[permission]
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
