// Shared property-access guard for assignment scoping (D6-001, ADR 0001 dynamic model).
// Pure: takes the accessible-property lookup as a callback so this module depends only
// on shared/domain types (no context-port imports). Callers pass their injected
// StaffPublicApi.getAccessiblePropertyIds bound lambda.
//
// The scope decision is resolved PER PERMISSION via scopeForPermission: a permission
// whose scope is 'organization' → all properties accessible (lookup returns null);
// otherwise the caller's assigned-property set. This is the crux of the no-widening
// rule — an org-wide grant on one permission can never widen another permission's
// record visibility (CONTEXT.md L72: "PropertyManagers only manage assigned properties").

import type { OrganizationId, PropertyId, UserId } from './ids'
import type { AuthContext } from './auth-context'
import type { Permission } from './permissions'
import { scopeForPermission } from './permissions'

/**
 * Returns the property IDs accessible to a user, or null when the caller is org-wide
 * for the governing permission (meaning "all properties"). `orgWide=false` → the user's
 * assigned-property set. The boolean is resolved by the caller via scopeForPermission.
 */
export type PropertyAccessLookup = (
  orgId: OrganizationId,
  userId: UserId,
  orgWide: boolean,
) => Promise<ReadonlyArray<PropertyId> | null>

/**
 * True when `propertyId` is within the caller's accessible set for `permission`.
 * Org-wide scope (scopeForPermission === 'organization') → all accessible; else the
 * assigned set. Each permission's scope governs only that permission's records.
 */
export const isPropertyAccessibleForPermission = async (
  lookup: PropertyAccessLookup,
  ctx: AuthContext,
  permission: Permission,
  propertyId: PropertyId,
): Promise<boolean> => {
  const orgWide = scopeForPermission(ctx, permission) === 'organization'
  const accessible = await lookup(ctx.organizationId, ctx.userId, orgWide)
  return accessible === null || accessible.includes(propertyId)
}

/**
 * The accessible-property set for `permission`, or null when org-wide (all properties).
 * Use this to scope list/fleet queries: null → no filter; else filter to the returned ids.
 */
export const getAccessiblePropertyIdsForPermission = async (
  lookup: PropertyAccessLookup,
  ctx: AuthContext,
  permission: Permission,
): Promise<ReadonlyArray<PropertyId> | null> => {
  const orgWide = scopeForPermission(ctx, permission) === 'organization'
  if (orgWide) return null
  return lookup(ctx.organizationId, ctx.userId, false)
}

/**
 * Low-level orgWide-based accessibility check. Callers that still resolve scope from a
 * raw role (the input.role use-case pattern, pending the ctx codemod) pass
 * `orgWide = role === 'AccountAdmin'`. Prefer {@link isPropertyAccessibleForPermission}
 * wherever a ctx with scopeByPermission is available, so custom/multi roles resolve.
 */
export const isPropertyAccessible = async (
  lookup: PropertyAccessLookup,
  orgId: OrganizationId,
  userId: UserId,
  orgWide: boolean,
  propertyId: PropertyId,
): Promise<boolean> => {
  const accessible = await lookup(orgId, userId, orgWide)
  return accessible === null || accessible.includes(propertyId)
}
