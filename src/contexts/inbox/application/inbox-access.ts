// Inbox context — shared access guards reused by inbox item use cases.
// Per architecture: application-layer helpers may import domain, ports, and
// shared/domain only. They must NOT import infrastructure or server modules.

import type { InboxRepository } from './ports/inbox.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { InboxItem } from '../domain/types'
import type { InboxItemId, OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
import { isPropertyAccessible } from '#/shared/domain/property-access'
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
 *  Semantics (root CONTEXT.md L72: "PropertyManagers only manage assigned
 *  properties"; staff public-api contract):
 *  - AccountAdmin: org-wide access — bypasses the lookup entirely.
 *  - PropertyManager / Staff: scoped to their `staff_assignment` properties.
 *
 *  Note: PropertyManager holds `inbox.manage`, but is NOT org-wide here —
 *  gating on `can(role,'inbox.manage')` would wrongly grant PM access to every
 *  property. The shared `isPropertyAccessible` helper resolves the accessible
 *  set via the staff-assignment lookup, exactly as the assignee check in
 *  `assignInboxItem` does. */
export const assertPropertyAccessible = async (
  staffPublicApi: StaffPublicApi,
  organizationId: OrganizationId,
  userId: UserId,
  role: Role,
  propertyId: PropertyId,
): Promise<void> => {
  // AccountAdmin (org-wide) bypasses — skip the lookup entirely.
  if (role === 'AccountAdmin') return
  // PropertyManager/Staff: scoped to assigned properties via staff_assignment.
  const accessible = await isPropertyAccessible(
    (orgId, uId, orgWide) => staffPublicApi.getAccessiblePropertyIds(orgId, uId, orgWide),
    organizationId,
    userId,
    false,
    propertyId,
  )
  if (!accessible) {
    throw inboxError('forbidden', 'No access to this property', { propertyId })
  }
}
