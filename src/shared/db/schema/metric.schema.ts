// Metric context — Drizzle schema for metric_definitions & metric_readings tables
// Per architecture: schemas live in shared/db/schema/ because Drizzle needs a single barrel.
// snake_case columns, camelCase field names.

import {
  pgTable,
  uuid,
  varchar,
  real,
  text,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { createdAtColumn } from '../columns'
import { properties } from './property.schema'
import { portals } from './portal.schema'
import { portalGroups } from './portal-group.schema'

export const metricDefinitions = pgTable(
  'metric_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    metricKey: varchar('metric_key', { length: 100 }).notNull(),
    displayName: varchar('display_name', { length: 200 }).notNull(),
    entityLevel: varchar('entity_level', { length: 20 }).notNull(),
    valueType: varchar('value_type', { length: 20 }).notNull(),
    description: text('description'),
    createdAt: createdAtColumn(),
  },
  (t) => [uniqueIndex('metric_definitions_key_unique').on(t.metricKey)],
)

export const metricReadings = pgTable(
  'metric_readings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    portalId: uuid('portal_id').references(() => portals.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id').references(() => portalGroups.id, { onDelete: 'set null' }),
    metricKey: varchar('metric_key', { length: 100 }).notNull(),
    value: real('value').notNull(),
    occurredAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('metric_readings_org_idx').on(t.organizationId),
    index('metric_readings_org_key_recorded_idx').on(
      t.organizationId,
      t.metricKey,
      t.occurredAt,
    ),
    index('metric_readings_org_property_idx').on(t.organizationId, t.propertyId),
  ],
)
