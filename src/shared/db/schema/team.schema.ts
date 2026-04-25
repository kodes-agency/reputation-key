// Team context — Drizzle schema for teams table
// Teams belong to a property within an organization.
// Per architecture: snake_case columns, camelCase field names.

import { sql } from 'drizzle-orm'
import { pgTable, uuid, varchar, text, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { properties } from './property.schema'
import { createdAtColumn, updatedAtColumn, deletedAtColumn } from '../columns'

export const teams = pgTable(
  'teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    teamLeadId: varchar('team_lead_id', { length: 255 }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: deletedAtColumn(),
  },
  (t) => ({
    orgPropertyIdx: index('teams_org_property_idx').on(t.organizationId, t.propertyId),
    orgPropertyNameUnique: uniqueIndex('teams_org_property_name_unique')
      .on(t.organizationId, t.propertyId, t.name)
      .where(sql`deleted_at IS NULL`),
  }),
)
