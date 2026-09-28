// Portal context — Drizzle schema for portal_groups table
// Portal groups aggregate multiple portals for department-level metrics.
// Per architecture: snake_case columns, camelCase field names.

import { pgTable, uuid, varchar, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { properties } from './property.schema'
import { createdAtColumn, updatedAtColumn, deletedAtColumn } from '../columns'

export const portalGroups = pgTable(
  'portal_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    // No inline `.references()` here: the composite `portal_groups_property_tenant_fk`
    // below is the only FK path into `properties`. An inline single-column
    // CASCADE used to exist alongside it, racing the composite RESTRICT FK's
    // trigger with no guaranteed firing order — an org purge could hit the
    // CASCADE path first and silently erase a portal_groups row before
    // Portal's own receipted purge ran for it (database-01).
    propertyId: uuid('property_id').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    sortKey: varchar('sort_key', { length: 255 }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: deletedAtColumn(),
  },
  (t) => [
    uniqueIndex('portal_groups_org_property_name_unique')
      .on(t.organizationId, t.propertyId, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex('portal_groups_org_property_id_key').on(
      t.organizationId,
      t.propertyId,
      t.id,
    ),
    foreignKey({
      name: 'portal_groups_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('restrict'),
  ],
)
