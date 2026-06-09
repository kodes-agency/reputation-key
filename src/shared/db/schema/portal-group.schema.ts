// Portal context — Drizzle schema for portal_groups table
// Portal groups aggregate multiple portals for department-level metrics.
// Per architecture: snake_case columns, camelCase field names.

import { pgTable, uuid, varchar, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { properties } from './property.schema'
import { createdAtColumn, updatedAtColumn, deletedAtColumn } from '../columns'

export const portalGroups = pgTable(
  'portal_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: deletedAtColumn(),
  },
  (t) => ({
    orgPropertyNameUnique: uniqueIndex('portal_groups_org_property_name_unique')
      .on(t.organizationId, t.propertyId, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
  }),
)
