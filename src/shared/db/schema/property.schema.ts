// Property context — Drizzle schema for properties table
// Per architecture: schemas live in shared/db/schema/ because Drizzle needs a single barrel.
// snake_case columns, camelCase field names.

import { sql } from 'drizzle-orm'
import { createdAtColumn, updatedAtColumn, deletedAtColumn } from '../columns'
import { pgTable, uuid, varchar, index, uniqueIndex } from 'drizzle-orm/pg-core'

export const properties = pgTable(
  'properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 64 }).notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    gbpPlaceId: varchar('gbp_place_id', { length: 500 }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: deletedAtColumn(),
  },
  (t) => ({
    orgSlugUnique: uniqueIndex('properties_org_slug_unique')
      .on(t.organizationId, t.slug)
      .where(sql`deleted_at IS NULL`),
    orgIdx: index('properties_org_idx').on(t.organizationId),
  }),
)
