// Badge context — Drizzle schema for badge definitions, org enablements, and awards.
// Per architecture: schemas live in shared/db/schema/ because Drizzle needs a single barrel.
// snake_case columns, camelCase field names.

import {
  pgTable,
  uuid,
  varchar,
  boolean,
  integer,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { createdAtColumn, updatedAtColumn } from '../columns'
import { properties } from './property.schema'
import { portals } from './portal.schema'
import { portalGroups } from './portal-group.schema'

export const badgeDefinitions = pgTable(
  'badge_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: varchar('key', { length: 100 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    icon: varchar('icon', { length: 50 }).notNull().default('award'),
    targetScope: varchar('target_scope', { length: 20 }).notNull(),
    criteriaVersion: integer('criteria_version').notNull().default(1),
    criteriaJson: jsonb('criteria_json').notNull().$type<Record<string, unknown>>(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('badge_definitions_key_unique').on(t.key),
    index('badge_definitions_target_scope_idx').on(t.targetScope),
  ],
)

export const organizationBadgeEnablements = pgTable(
  'organization_badge_enablements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    badgeDefinitionId: uuid('badge_definition_id')
      .notNull()
      .references(() => badgeDefinitions.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('org_badge_enablements_org_definition_unique').on(
      t.organizationId,
      t.badgeDefinitionId,
    ),
    index('org_badge_enablements_org_idx').on(t.organizationId),
  ],
)

export const badgeAwards = pgTable(
  'badge_awards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    badgeDefinitionId: uuid('badge_definition_id')
      .notNull()
      .references(() => badgeDefinitions.id, { onDelete: 'cascade' }),
    criteriaVersion: integer('criteria_version').notNull(),
    targetType: varchar('target_type', { length: 20 }).notNull(),
    targetId: uuid('target_id').notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    portalId: uuid('portal_id').references(() => portals.id, { onDelete: 'set null' }),
    portalGroupId: uuid('portal_group_id').references(() => portalGroups.id, {
      onDelete: 'set null',
    }),
    awardedAt: timestamp('awarded_at', { withTimezone: true }).notNull(),
    uniqueKey: varchar('unique_key', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex('badge_awards_unique_key_unique').on(t.uniqueKey),
    index('badge_awards_org_property_idx').on(t.organizationId, t.propertyId),
    index('badge_awards_target_idx').on(t.targetType, t.targetId),
    index('badge_awards_portal_idx').on(t.portalId),
    index('badge_awards_group_idx').on(t.portalGroupId),
  ],
)
