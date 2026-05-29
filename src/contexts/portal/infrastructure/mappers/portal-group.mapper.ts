// Portal context — PortalGroup row ↔ domain mapper
import type { portalGroups } from '#/shared/db/schema/portal-group.schema'
import type { PortalGroup } from '../../domain/portal-group-types'
import { portalGroupId, organizationId, propertyId } from '#/shared/domain/ids'

type PortalGroupRow = typeof portalGroups.$inferSelect

export const portalGroupFromRow = (row: PortalGroupRow): PortalGroup => ({
  id: portalGroupId(row.id),
  organizationId: organizationId(row.organizationId),
  propertyId: propertyId(row.propertyId),
  name: row.name,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})
