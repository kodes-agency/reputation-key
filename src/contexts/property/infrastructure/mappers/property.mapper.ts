// Property context — row ↔ domain mapper
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { properties } from '#/shared/db/schema/property.schema'
import type { Property } from '../../domain/types'
import type { PropertyId } from '#/shared/domain/ids'
import type { OrganizationId } from '#/shared/domain/ids'

type PropertyRow = typeof properties.$inferSelect
type PropertyInsertRow = typeof properties.$inferInsert

export const propertyFromRow = (row: PropertyRow): Property => ({
  id: row.id as PropertyId,
  organizationId: row.organizationId as OrganizationId,
  name: row.name,
  slug: row.slug,
  timezone: row.timezone,
  gbpPlaceId: row.gbpPlaceId,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt,
})

export const propertyToRow = (property: Property): PropertyInsertRow => ({
  id: property.id,
  organizationId: property.organizationId,
  name: property.name,
  slug: property.slug,
  timezone: property.timezone,
  gbpPlaceId: property.gbpPlaceId,
  createdAt: property.createdAt,
  updatedAt: property.updatedAt,
  deletedAt: property.deletedAt,
})
