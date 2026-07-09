// resolve-permissions — pure core of the dynamic authorization resolver (ADR 0001).
//
// Given a member's role names plus the org's custom-role definitions and policies,
// produce the effective permission set and the per-permission data scope. A
// permission's scope is the BROADEST scope among all roles that grant it — so an
// `analytics.read@organization` grant can never widen an unrelated
// `portal.update@assigned-properties` grant (each permission's scope governs only
// that permission's records). Built-in roles (owner/admin/member) carry fixed
// scopes; custom roles carry their policy's data_scope. A custom role missing its
// definition or policy is skipped (fail-closed + warn) — it grants nothing.
//
// Pure: takes its inputs (including the built-in permission provider) and returns
// a result. No DB, no IO. resolveTenantContext (Stage 2 step 5) fetches the rows
// and calls this.

import type { Permission } from '#/shared/domain/permissions'
import type { DataScope } from '#/shared/domain/data-scope'
import { broadestScope } from '#/shared/domain/data-scope'
import { getLogger } from '#/shared/observability/logger'

/** Fixed v1 scope for each built-in Better Auth role. */
export const BUILT_IN_ROLE_SCOPE: Readonly<Record<string, DataScope>> = {
  owner: 'organization',
  admin: 'assigned-properties',
  member: 'assigned-properties',
}
const BUILT_IN_ROLES = new Set(Object.keys(BUILT_IN_ROLE_SCOPE))

/** A custom role definition: name + the validated permissions it grants. */
export type CustomRoleDef = Readonly<{ role: string; permissions: readonly Permission[] }>

/** A custom role's app-owned scope row (organization_role_policy). */
export type RolePolicy = Readonly<{ role: string; dataScope: DataScope }>

export type ResolvePermissionsResult = Readonly<{
  effectivePermissions: ReadonlySet<Permission>
  scopeByPermission: ReadonlyMap<Permission, DataScope>
}>

/** Returns the permission set a built-in BA role grants (wired to the static table in prod). */
export type BuiltInPermissionProvider = (baRole: string) => ReadonlySet<Permission>

/**
 * Resolve effective permissions + per-permission scopes for a member.
 *
 * `roleNames` are canonicalized here (trim/lower-case); `customRoles` and `policies`
 * are keyed by canonical role name. Built-in role names are reserved and never
 * looked up in the custom sets.
 */
export function resolvePermissions(input: {
  roleNames: readonly string[]
  customRoles: ReadonlyArray<CustomRoleDef>
  policies: ReadonlyArray<RolePolicy>
  builtInPermissions: BuiltInPermissionProvider
}): ResolvePermissionsResult {
  const effective = new Set<Permission>()
  const scopeByPerm = new Map<Permission, DataScope>()
  const customRoleByRole = new Map(input.customRoles.map((r) => [r.role, r]))
  const policyByRole = new Map(input.policies.map((p) => [p.role, p]))

  const broaden = (perm: Permission, scope: DataScope): void => {
    effective.add(perm)
    scopeByPerm.set(perm, broadestScope(scopeByPerm.get(perm) ?? 'none', scope))
  }

  for (const rawName of input.roleNames) {
    const name = rawName.trim().toLowerCase()
    if (!name) continue

    if (BUILT_IN_ROLES.has(name)) {
      const scope = BUILT_IN_ROLE_SCOPE[name]
      for (const perm of input.builtInPermissions(name)) {
        broaden(perm, scope)
      }
      continue
    }

    const def = customRoleByRole.get(name)
    const policy = policyByRole.get(name)
    if (!def || !policy) {
      getLogger().warn(
        { role: name },
        'resolve_permissions: custom role missing definition or policy; skipping (fail-closed)',
      )
      continue
    }
    for (const perm of def.permissions) {
      broaden(perm, policy.dataScope)
    }
  }

  return { effectivePermissions: effective, scopeByPermission: scopeByPerm }
}
