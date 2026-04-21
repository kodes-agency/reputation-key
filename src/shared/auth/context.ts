// AuthContext — the authenticated context passed through server functions and middleware.
// Per architecture: "tenantMiddleware resolves org from session and attaches to AuthContext."
// Use cases receive this as their second parameter: (input, ctx) => Result
import type { OrganizationId, UserId } from '#/shared/domain/ids'

/** Roles matching better-auth organization plugin + our domain mapping:
 *  owner → AccountAdmin
 *  admin → PropertyManager
 *  member → Staff
 */
export type Role = 'AccountAdmin' | 'PropertyManager' | 'Staff'

/** Auth context attached to every authenticated request. */
export type AuthContext = Readonly<{
  userId: UserId
  organizationId: OrganizationId
  role: Role
}>

/** Role hierarchy: AccountAdmin > PropertyManager > Staff */
export const ROLE_HIERARCHY: Readonly<Record<Role, number>> = {
  Staff: 0,
  PropertyManager: 1,
  AccountAdmin: 2,
}

/** Check if a role meets a minimum required role. */
export function hasRole(userRole: Role, requiredRole: Role): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole]
}
