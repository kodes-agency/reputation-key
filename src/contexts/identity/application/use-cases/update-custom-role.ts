// Identity context — update custom role use case (ADR 0001, app-owned role writes).
// Same escalation gate as create: the new permission set + scope must be within what
// the caller holds. The atomic orgRole + policy update is delegated to the port.

import type { IdentityPort } from '../ports/identity.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import { canForContext } from '#/shared/domain/permissions'
import { identityError } from '../../domain/errors'
import { assertGrantablePermissions } from '../role-escalation-guard'
import type { UpdateCustomRoleInput } from '../dto/custom-role.dto'

export type { UpdateCustomRoleInput }
export type UpdateCustomRole = ReturnType<typeof updateCustomRole>

export type UpdateCustomRoleDeps = Readonly<{ identity: IdentityPort }>

export const updateCustomRole =
  (deps: UpdateCustomRoleDeps) =>
  async (input: UpdateCustomRoleInput, ctx: AuthContext): Promise<void> => {
    if (!canForContext(ctx, 'member.update')) {
      throw identityError('forbidden', 'Insufficient role to manage custom roles')
    }

    const perms = input.permissions as ReadonlyArray<Permission>
    assertGrantablePermissions(ctx, perms, input.dataScope)

    await deps.identity.updateCustomRole(ctx, input.role, {
      permissions: perms,
      dataScope: input.dataScope,
    })
  }
