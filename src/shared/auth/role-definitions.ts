// Pure role-definition helpers for the dynamic resolver (ADR 0001 Stage 2).
// The DB fetch (fetchRoleDefinitions) lives in shared/db/role-definitions.ts because
// drizzle-orm is restricted to shared/db/ + infrastructure/ by the eslint boundary rules.
// Keeping the mapping pure here makes it unit-testable without a DB.

import { VALID_PERMISSIONS, parsePermissionStatement } from './permission-catalogue'
import { can } from '#/shared/domain/permissions'
import type { Permission } from '#/shared/domain/permissions'
import { toDomainRole } from '#/shared/domain/roles'
import { isDataScope } from '#/shared/domain/data-scope'
import type { CustomRoleDef, RolePolicy } from './resolve-permissions'

/** A raw organizationRole row (only the columns the resolver reads). */
export type RoleDefRow = Readonly<{ role: string; permission: string | null }>

/** A raw organization_role_policy row. */
export type PolicyRow = Readonly<{ role: string; dataScope: string }>

/**
 * The permission set a built-in Better Auth role grants. Passed as the
 * `builtInPermissions` provider to resolvePermissions — derived from the static
 * permission table so the resolver stays pure (no direct table import).
 */
export function builtInPermissionsForRole(baRole: string): ReadonlySet<Permission> {
  const domain = toDomainRole(baRole)
  if (!domain) return new Set()
  return new Set(VALID_PERMISSIONS.filter((p) => can(domain, p)))
}

/** Pure: map raw role-def + policy rows into resolvePermissions' input shape. */
export function mapRoleDefinitions(
  roleDefRows: ReadonlyArray<RoleDefRow>,
  policyRows: ReadonlyArray<PolicyRow>,
): { customRoles: readonly CustomRoleDef[]; policies: readonly RolePolicy[] } {
  return {
    customRoles: roleDefRows.map((r) => ({
      role: r.role.trim().toLowerCase(),
      permissions: parsePermissionStatement(r.permission),
    })),
    policies: policyRows.map((p) => ({
      role: p.role.trim().toLowerCase(),
      dataScope: isDataScope(p.dataScope) ? p.dataScope : 'none',
    })),
  }
}
