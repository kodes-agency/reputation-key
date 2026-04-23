// Role types and hierarchy — shared across auth middleware and domain contexts.
// Per architecture: "shared/ holds cross-cutting concerns used by multiple contexts."
// The canonical Role definition and all role-mapping functions live here.
// Contexts and shared/ modules import from this single source of truth.

/** Our domain roles — mapped from better-auth organization plugin roles. */
export type Role = 'AccountAdmin' | 'PropertyManager' | 'Staff'

/** The roles as better-auth understands them. */
export type BetterAuthRole = 'owner' | 'admin' | 'member'

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

/** Map a better-auth role string to our domain Role. */
export function toDomainRole(betterAuthRole: string): Role {
  switch (betterAuthRole) {
    case 'owner':
      return 'AccountAdmin'
    case 'admin':
      return 'PropertyManager'
    case 'member':
      return 'Staff'
    default:
      return 'Staff'
  }
}

/** Map our domain Role back to a better-auth role string. */
export function toBetterAuthRole(role: Role): BetterAuthRole {
  switch (role) {
    case 'AccountAdmin':
      return 'owner'
    case 'PropertyManager':
      return 'admin'
    case 'Staff':
      return 'member'
  }
}
