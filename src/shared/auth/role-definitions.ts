// Built-in role authority: which permissions each Better Auth role token grants and
// the data scope they carry. Pure, so it is unit-testable without a DB; the
// tenant resolver reads the organization's permission_version separately.

import { VALID_PERMISSIONS } from './permission-catalogue'
import { can } from '#/shared/domain/permissions'
import type { Permission } from '#/shared/domain/permissions'
import { toDomainRole } from '#/shared/domain/roles'
import type { DataScope } from '#/shared/domain/data-scope'

/** Fixed data scope for each built-in Better Auth role. */
export const BUILT_IN_ROLE_SCOPE: Readonly<Record<string, DataScope>> = {
  owner: 'organization',
  admin: 'assigned-properties',
  member: 'assigned-properties',
}

/**
 * The permission set a built-in Better Auth role grants, derived from the static
 * permission table. A token that is not a built-in role grants nothing.
 */
export function builtInPermissionsForRole(baRole: string): ReadonlySet<Permission> {
  const domain = toDomainRole(baRole)
  if (!domain) return new Set()
  return new Set(VALID_PERMISSIONS.filter((p) => can(domain, p)))
}
