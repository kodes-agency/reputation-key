// Portal context — row ↔ domain mapper
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { portals } from '#/shared/db/schema/portal.schema'
import type { Portal } from '../../domain/types'
import { portalId, organizationId, propertyId } from '#/shared/domain/ids'
import type { PortalTheme } from '../../domain/types'

type PortalRow = typeof portals.$inferSelect
type PortalInsertRow = typeof portals.$inferInsert

export const portalFromRow = (row: PortalRow): Portal => ({
  id: portalId(row.id),
  organizationId: organizationId(row.organizationId),
  propertyId: propertyId(row.propertyId),
  entityType: row.entityType as 'property' | 'team' | 'staff',
  entityId: row.entityId,
  name: row.name,
  slug: row.slug,
  description: row.description,
  heroImageUrl: row.heroImageUrl,
  theme: (row.theme ?? { primaryColor: '#6366F1' }) as PortalTheme,
  smartRoutingEnabled: row.smartRoutingEnabled,
  smartRoutingThreshold: row.smartRoutingThreshold,
  isActive: row.isActive,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt,
})

export const portalToRow = (portal: Portal): PortalInsertRow => ({
  id: portal.id as unknown as string,
  organizationId: portal.organizationId as unknown as string,
  propertyId: portal.propertyId as unknown as string,
  entityType: portal.entityType,
  entityId: portal.entityId,
  name: portal.name,
  slug: portal.slug,
  description: portal.description,
  heroImageUrl: portal.heroImageUrl,
  theme: portal.theme as Record<string, unknown>,
  smartRoutingEnabled: portal.smartRoutingEnabled,
  smartRoutingThreshold: portal.smartRoutingThreshold,
  isActive: portal.isActive,
  createdAt: portal.createdAt,
  updatedAt: portal.updatedAt,
  deletedAt: portal.deletedAt,
})
