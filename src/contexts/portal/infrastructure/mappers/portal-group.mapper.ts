// Portal context — PortalGroup row ↔ domain mapper
import type { portalGroups } from '#/shared/db/schema/portal-group.schema'
import type { PortalGroup } from '../../domain/types'
import { portalGroupId, organizationId, propertyId } from '#/shared/domain/ids'
import { unbrand } from '#/shared/domain/ids'

type PortalGroupRow = typeof portalGroups.$inferSelect
type PortalGroupInsert = typeof portalGroups.$inferInsert

export const portalGroupFromRow = (row: PortalGroupRow): PortalGroup => ({
  id: portalGroupId(row.id),
  organizationId: organizationId(row.organizationId),
  propertyId: propertyId(row.propertyId),
  name: row.name,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const portalGroupToRow = (group: PortalGroup): PortalGroupInsert => ({
  id: unbrand(group.id),
  organizationId: unbrand(group.organizationId),
  propertyId: unbrand(group.propertyId),
  name: group.name,
  createdAt: group.createdAt,
  updatedAt: group.updatedAt,
})
