// Inbox context — shared access guards reused by inbox item use cases.
// Per architecture: application-layer helpers may import domain, ports, and
// shared/domain only. They must NOT import infrastructure or server modules.

import type { InboxRepository } from './ports/inbox.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { InboxItem } from '../domain/types'
import type { InboxItemId, OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
import { can } from '#/shared/domain/permissions'
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

/** Throws `forbidden` when a role without `inbox.manage` lacks access to the
 *  given property. Roles holding `inbox.manage` (AccountAdmin, PropertyManager)
 *  bypass the check — `getAccessiblePropertyIds` returns `null` for them. */
export const assertPropertyAccessible = async (
  staffPublicApi: StaffPublicApi,
  organizationId: OrganizationId,
  userId: UserId,
  role: Role,
  propertyId: PropertyId,
): Promise<void> => {
  if (can(role, 'inbox.manage')) return
  const accessible = await staffPublicApi.getAccessiblePropertyIds(
    organizationId,
    userId,
    role,
  )
  if (accessible !== null && !accessible.includes(propertyId)) {
    throw inboxError('forbidden', 'No access to this property', { propertyId })
  }
}
