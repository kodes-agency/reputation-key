// AuthorizationPolicy — centralized authorization decisions for beta (B0.6).
//
// Combines three layers into a single authorize() call:
//   1. Beta capability check (is the feature enabled for this org?)
//   2. Role-based permission check (does the user's role allow this action?)
//   3. Property-scope validation (can the user access this specific property?)
//
// This is the single entry point for authorization in server functions and
// use cases. Contexts should not branch on role strings or duplicate logic.
//
// ADR 0033 will formalize this as the authoritative authorization interface.

import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import { canForContext, scopeForPermission } from '#/shared/domain/permissions'
import type { DataScope } from '#/shared/domain/data-scope'
import { checkBetaCapability, type Capability } from '#/shared/auth/beta-capabilities'

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

export class AuthorizationError extends Error {
  constructor(public readonly decision: AuthorizationDecision) {
    super(`Authorization denied: ${decision.reason}`)
    this.name = 'AuthorizationError'
  }
}

export { type DataScope }
