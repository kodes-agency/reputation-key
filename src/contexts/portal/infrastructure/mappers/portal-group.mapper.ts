// Portal context — portal group row ↔ domain mapper
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { portalGroups } from '#/shared/db/schema/portal.schema'
import type { PortalGroup } from '../../domain/types'
import { portalGroupId, organizationId, propertyId, unbrand } from '#/shared/domain/ids'

type PortalGroupRow = typeof portalGroups.$inferSelect
type PortalGroupInsertRow = typeof portalGroups.$inferInsert

export const portalGroupFromRow = (row: PortalGroupRow): PortalGroup => ({
  id: portalGroupId(row.id),
  organizationId: organizationId(row.organizationId),
  propertyId: propertyId(row.propertyId),
  name: row.name,
  sortKey: row.sortKey,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt,
})

export const portalGroupToRow = (group: PortalGroup): PortalGroupInsertRow => ({
  id: unbrand(group.id),
  organizationId: unbrand(group.organizationId),
  propertyId: unbrand(group.propertyId),
  name: group.name,
  sortKey: group.sortKey,
  createdAt: group.createdAt,
  updatedAt: group.updatedAt,
  deletedAt: group.deletedAt,
})
