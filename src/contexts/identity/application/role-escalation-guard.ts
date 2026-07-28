// Identity context — privilege-escalation gate (single source, BQC-5.9 E6).
//
// Every granted permission must be held by the caller, and the role's
// dataScope may not be broader than the caller's scope for that permission —
// so an assigned-scoped actor can never mint an org-scoped role, and no one
// can grant a permission they do not hold. Create and update custom role
// MUST share this gate; it exists exactly once.

import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import { canForContext, scopeForPermission } from '#/shared/domain/permissions'
import { broadestScope, type DataScope } from '#/shared/domain/data-scope'
import { identityError } from '../domain/errors'

/** Throw forbidden when the permission set + scope exceeds what the caller holds. */
export function assertGrantablePermissions(
  ctx: AuthContext,
  perms: ReadonlyArray<Permission>,
  dataScope: DataScope,
): void {
  for (const perm of perms) {
    if (!canForContext(ctx, perm)) {
      throw identityError(
        'forbidden',
        `Cannot grant a permission you do not hold: ${perm}`,
      )
    }
    const callerScope = scopeForPermission(ctx, perm)
    if (broadestScope(dataScope, callerScope) !== callerScope) {
      throw identityError(
        'forbidden',
        `Cannot grant ${perm} at ${dataScope} scope (you hold ${callerScope})`,
      )
    }
  }
}
