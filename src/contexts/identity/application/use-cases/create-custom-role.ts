// Identity context — create custom role use case (ADR 0001, app-owned role writes).
// Per architecture: authorize → validate → check invariants → persist.
// The raw BA create-role endpoint is permanently blocked; this is the only write path.

import type { IdentityPort } from '../ports/identity.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import { canForContext, scopeForPermission } from '#/shared/domain/permissions'
import { broadestScope } from '#/shared/domain/data-scope'
import { identityError } from '../../domain/errors'
import type { CreateCustomRoleInput } from '../dto/custom-role.dto'

// fallow-ignore-next-line unused-type
export type { CreateCustomRoleInput }
export type CreateCustomRole = ReturnType<typeof createCustomRole>

export type CreateCustomRoleDeps = Readonly<{ identity: IdentityPort }>

/**
 * Create a custom role definition (organizationRole + organization_role_policy) via the
 * app-owned service. Escalation: every granted permission must be held by the caller, and
 * the role's dataScope may not be broader than the caller's scope for that permission — so
 * an assigned-scoped actor can never mint an org-scoped role, and no one can grant a
 * permission they do not hold.
 */
export const createCustomRole =
  (deps: CreateCustomRoleDeps) =>
  async (input: CreateCustomRoleInput, ctx: AuthContext): Promise<void> => {
    // 1. Authorize — role management is a member-management privilege.
    if (!canForContext(ctx, 'member.update')) {
      throw identityError('forbidden', 'Insufficient role to manage custom roles')
    }

    const perms = input.permissions as ReadonlyArray<Permission>

    // 2. Escalation check — the security gate.
    for (const perm of perms) {
      if (!canForContext(ctx, perm)) {
        throw identityError(
          'forbidden',
          `Cannot grant a permission you do not hold: ${perm}`,
        )
      }
      const callerScope = scopeForPermission(ctx, perm)
      if (broadestScope(input.dataScope, callerScope) !== callerScope) {
        throw identityError(
          'forbidden',
          `Cannot grant ${perm} at ${input.dataScope} scope (you hold ${callerScope})`,
        )
      }
    }

    // 3. Persist — atomic orgRole + policy write (port → adapter drizzle txn).
    //    Duplicate name → already_exists (409) from the unique constraint.
    await deps.identity.createCustomRole(ctx, {
      role: input.role,
      permissions: perms,
      dataScope: input.dataScope,
    })
  }
