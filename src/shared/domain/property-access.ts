// Shared property-access guard for PropertyManager/Staff assignment scoping.
// Pure: takes the accessible-property lookup as a callback so this module
// depends only on shared/domain types (no context-port imports). Callers
// pass their injected StaffPublicApi.getAccessiblePropertyIds bound lambda.
//
// Semantics: AccountAdmin has org-wide access (the lookup returns null);
// PropertyManager/Staff are scoped to their assigned properties. This is
// the stricter form of inbox's assertPropertyAccessible — PM is NOT org-wide
// here (CONTEXT.md L72: "PropertyManagers only manage assigned properties").

import type { OrganizationId, PropertyId, UserId } from './ids'
import type { Role } from './roles'

/** Returns the property IDs accessible to a user, or null when the user has
 *  org-wide access (AccountAdmin). PM/Staff get their assigned-property list. */
export type AccessiblePropertyLookup = (
  orgId: OrganizationId,
  userId: UserId,
  role: Role,
) => Promise<ReadonlyArray<PropertyId> | null>

/** True when `propertyId` is within the caller's accessible set.
 *  A null set (AccountAdmin) means all properties are accessible. */
export const isPropertyAccessible = async (
  lookup: AccessiblePropertyLookup,
  orgId: OrganizationId,
  userId: UserId,
  role: Role,
  propertyId: PropertyId,
): Promise<boolean> => {
  const accessible = await lookup(orgId, userId, role)
  return accessible === null || accessible.includes(propertyId)
}
