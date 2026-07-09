// Identity context — delete custom role use case (ADR 0001, app-owned role writes).
// Removes the role definition atomically. Members still holding the role become
// permissionless via the resolver's fail-closed path (missing definition → no perms).

import type { IdentityPort } from '../ports/identity.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { identityError } from '../../domain/errors'
import type { DeleteCustomRoleInput } from '../dto/custom-role.dto'

// fallow-ignore-next-line unused-type
export type { DeleteCustomRoleInput }
export type DeleteCustomRole = ReturnType<typeof deleteCustomRole>

export type DeleteCustomRoleDeps = Readonly<{ identity: IdentityPort }>

export const deleteCustomRole =
  (deps: DeleteCustomRoleDeps) =>
  async (input: DeleteCustomRoleInput, ctx: AuthContext): Promise<void> => {
    if (!canForContext(ctx, 'member.update')) {
      throw identityError('forbidden', 'Insufficient role to manage custom roles')
    }
    await deps.identity.deleteCustomRole(ctx, input.role)
  }
