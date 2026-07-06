// Role types and hierarchy — shared across auth middleware and domain contexts.
// Per architecture: "shared/ holds cross-cutting concerns used by multiple contexts."
// The canonical Role definition and all role-mapping functions live here.
// Contexts and shared/ modules import from this single source of truth.
import { assertNever } from './assert'
import { domainError } from './errors'

/** Our domain roles — mapped from better-auth organization plugin roles. */
export type Role = 'AccountAdmin' | 'PropertyManager' | 'Staff'

/** The roles as better-auth understands them. */
// fallow-ignore-next-line unused-type
export type BetterAuthRole = 'owner' | 'admin' | 'member'

/** Role hierarchy: AccountAdmin > PropertyManager > Staff */
export const ROLE_HIERARCHY: Readonly<Record<Role, number>> = {
  Staff: 0,
  PropertyManager: 1,
  AccountAdmin: 2,
}

/** Admin role constant for type-safe role checks. */
export const ADMIN_ROLE: Role = 'AccountAdmin'

/** Check if a role meets a minimum required role. */
export function hasRole(userRole: Role, requiredRole: Role): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole]
}

/**
 * Map a better-auth role string to our domain Role, or null for non-built-in roles.
 *
 * Stage 1 (ENABLE_CUSTOM_ROLES=false): resolveTenantContext treats null as a
 * boundary reject (403) — fail-closed. Stage 2 will route null to the dynamic
 * permission resolver (custom/multi roles). Returning null (instead of throwing)
 * lets the middleware decide policy without a try/catch on the auth hot path.
 */
export function toDomainRole(betterAuthRole: string): Role | null {
  switch (betterAuthRole) {
    case 'owner':
      return 'AccountAdmin'
    case 'admin':
      return 'PropertyManager'
    case 'member':
      return 'Staff'
    default:
      return null
  }
}
/**
 * Strict variant: map a better-auth role to a domain Role, throwing a typed
 * `unknown_role` DomainError for non-built-in roles.
 *
 * Use at sites that require a `Role` (member/invitation DTOs, role write paths).
 * In Stage 1 a null never occurs in correct operation — no custom roles exist
 * (all write paths are blocked or built-in-validated) — so a throw surfaces data
 * corruption or a bypassed write path loudly instead of silently mislabelling.
 * Prefer `toDomainRole` where the caller decides null policy (e.g. middleware).
 */
export function toDomainRoleStrict(betterAuthRole: string): Role {
  const role = toDomainRole(betterAuthRole)
  if (role === null) {
    throw domainError('unknown_role', `Unknown better-auth role: ${betterAuthRole}`, {
      value: betterAuthRole,
    })
  }
  return role
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
    default:
      return assertNever('toBetterAuthRole', role)
  }
}
