// Inbox context — visible-property resolution (single source, BQC-5.9 E12).
//
// Authorizes the permission and resolves the caller's visible properties
// PER PERMISSION via scopeForPermission: org-wide scope (AccountAdmin) →
// 'all'; assigned scope (PropertyManager/Staff) → their staff_assignment
// set. PM holds inbox.manage but inbox.read scope is assigned — so PM is
// scoped (CONTEXT.md L72).
//
// Anti-leak rule: a scoped user with NO property assignments sees ZERO
// inbox items — never the org-wide set. The 'none' marker makes that explicit
// at every call site, and repositories independently fail closed on [] so a
// future caller cannot accidentally widen an empty scope.

import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { PropertyId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import { canForContext } from '#/shared/domain/permissions'
import { getAccessiblePropertyIdsForPermission } from '#/shared/domain/property-access'
import { inboxError } from '../domain/errors'

export type VisibleProperties = 'all' | 'none' | ReadonlyArray<PropertyId>

/**
 * Authorize `permission` and resolve the caller's visible properties:
 * 'all' (org-wide scope), 'none' (assigned scope with zero assignments —
 * fail-closed), or the assigned property id set.
 */
export async function resolveVisiblePropertyIds(
  staffPublicApi: StaffPublicApi,
  ctx: AuthContext,
  permission: Permission,
): Promise<VisibleProperties> {
  if (!canForContext(ctx, permission)) {
    throw inboxError('forbidden', 'No inbox read permission')
  }

  const accessible = await getAccessiblePropertyIdsForPermission(
    (orgId, uId, orgWide) => staffPublicApi.getAccessiblePropertyIds(orgId, uId, orgWide),
    ctx,
    permission,
  )
  if (accessible === null) return 'all'
  if (accessible.length === 0) return 'none'
  return accessible
}
