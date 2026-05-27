// Portal context — PortalGroup domain types
import type { OrganizationId, PortalGroupId, PropertyId } from '#/shared/domain/ids'

export type PortalGroup = Readonly<{
  id: PortalGroupId
  organizationId: OrganizationId
  propertyId: PropertyId
  name: string
  createdAt: Date
  updatedAt: Date
}>
