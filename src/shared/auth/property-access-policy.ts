// BETA-1 B1.4: Property access policy — centralized tenant + lifecycle guard.
//
// Combines three checks into one assertion that property-scoped operations
// (sync, publish, triage, metrics) call before touching data:
//
//   1. Tenant consistency: property belongs to the actor's organization
//   2. Lifecycle state: property allows the requested operation (caller passes isBlocked)
//   3. Assignment scope: actor has been assigned to this property
//      (skipped for org-wide roles like AccountAdmin)
//
// This is the defense-in-depth layer. The primary authorization gate remains
// AuthorizationPolicy.authorize(). This module adds property-specific
// invariants that the generic policy doesn't cover.

export type PropertyAccessError =
  | { code: 'wrong_organization'; propertyOrg: string; actorOrg: string }
  | { code: 'property_blocked' }
  | { code: 'not_assigned'; propertyId: string }

export type PropertyAccessInput = Readonly<{
  /** The property's organization ID. */
  propertyOrganizationId: string
  /** The actor's organization ID. */
  actorOrganizationId: string
  /** Whether the property's lifecycle state blocks external effects. */
  isPropertyBlocked: boolean
  /** The property ID being accessed. */
  propertyId: string
  /** Set of property IDs the actor is assigned to (empty = org-wide access). */
  assignedPropertyIds: ReadonlySet<string>
  /** Whether the actor has org-wide access (e.g., AccountAdmin role). */
  hasOrgWideAccess: boolean
}>

/**
 * Check if the actor can access a specific property.
 * Returns the error if denied, or null if allowed.
 */
export function checkPropertyAccess(
  input: PropertyAccessInput,
): PropertyAccessError | null {
  // 1. Tenant consistency: property must belong to actor's organization
  if (input.propertyOrganizationId !== input.actorOrganizationId) {
    return {
      code: 'wrong_organization',
      propertyOrg: input.propertyOrganizationId,
      actorOrg: input.actorOrganizationId,
    }
  }

  // 2. Lifecycle: property must not be in a blocked state
  if (input.isPropertyBlocked) {
    return { code: 'property_blocked' }
  }

  // 3. Assignment scope: actor must be assigned to the property
  //    (unless they have org-wide access)
  if (!input.hasOrgWideAccess && !input.assignedPropertyIds.has(input.propertyId)) {
    return { code: 'not_assigned', propertyId: input.propertyId }
  }

  return null
}

/**
 * Assert that the actor can access a specific property.
 * Throws on denied access.
 */
export function assertPropertyAccess(input: PropertyAccessInput): void {
  const error = checkPropertyAccess(input)
  if (error) {
    throw error
  }
}
