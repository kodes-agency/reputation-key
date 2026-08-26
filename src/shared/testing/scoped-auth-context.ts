import type { AuthContext } from '#/shared/domain/auth-context'
import type { DataScope } from '#/shared/domain/data-scope'
import type { OrganizationId, UserId } from '#/shared/domain/ids'
import type { Permission } from '#/shared/domain/permissions'
import type { Role } from '#/shared/domain/roles'

export type PermissionScopeEntry = readonly [Permission, DataScope]

/** Test fixture for dynamic roles whose permissions intentionally differ in scope. */
export const createScopedAuthContext = (
  input: Readonly<{
    organizationId: OrganizationId
    userId: UserId
    permissions: ReadonlyArray<PermissionScopeEntry>
    role?: Role
  }>,
): AuthContext => ({
  organizationId: input.organizationId,
  userId: input.userId,
  role: input.role ?? 'Staff',
  effectivePermissions: new Set(input.permissions.map(([permission]) => permission)),
  scopeByPermission: new Map(input.permissions),
})
