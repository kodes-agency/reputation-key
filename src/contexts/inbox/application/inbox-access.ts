// Inbox context — shared access guards reused by inbox item use cases.
// Per architecture: application-layer helpers may import domain, ports, and
// shared/domain only. They must NOT import infrastructure or server modules.

import type { InboxRepository } from './ports/inbox.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { InboxItem } from '../domain/types'
import type { InboxItemId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'
import { inboxError } from '../domain/errors'

/** Finds an inbox item by id, throwing `not_found` when it does not exist. */
export const loadInboxItemOrThrow = async (
  repo: InboxRepository,
  id: InboxItemId,
  organizationId: OrganizationId,
): Promise<InboxItem> => {
  const item = await repo.findById(id, organizationId)
  if (!item) {
    throw inboxError('not_found', 'Inbox item not found', { inboxItemId: id })
  }
  return item
}

/** Throws `forbidden` when the caller lacks access to the given property.
 *
 *  Scope is resolved PER PERMISSION via scopeForPermission: org-wide scope
 *  (AccountAdmin) → all accessible; assigned scope (PropertyManager/Staff) →
 *  the caller's staff_assignment properties. Note: PM holds `inbox.manage`
 *  but inbox visibility is governed by inbox.read/inbox.write scope, which is
 *  assigned for PM — so gating on `can(role,'inbox.manage')` would wrongly
 *  grant PM org-wide access (CONTEXT.md L72). */
export const assertPropertyAccessible = async (
  staffPublicApi: StaffPublicApi,
  ctx: AuthContext,
  permission: Permission,
  propertyId: PropertyId,
): Promise<void> => {
  const accessible = await isPropertyAccessibleForPermission(
    (orgId, uId, orgWide) => staffPublicApi.getAccessiblePropertyIds(orgId, uId, orgWide),
    ctx,
    permission,
    propertyId,
  )
  if (!accessible) {
    throw inboxError('forbidden', 'No access to this property', { propertyId })
  }
}
