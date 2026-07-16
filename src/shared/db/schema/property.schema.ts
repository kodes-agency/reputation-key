// Property context — Drizzle schema for properties table
// Per architecture: schemas live in shared/db/schema/ because Drizzle needs a single barrel.
// snake_case columns, camelCase field names.

import { sql } from 'drizzle-orm'
import { createdAtColumn, updatedAtColumn, deletedAtColumn } from '../columns'
import { googleConnections } from './google-connection.schema'
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const properties = pgTable(
  'properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 64 }).notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    gbpPlaceId: varchar('gbp_place_id', { length: 500 }),
    googleConnectionId: uuid('google_connection_id').references(
      () => googleConnections.id,
      { onDelete: 'set null' },
    ),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: deletedAtColumn(),
    // B1.5: Lifecycle state machine (migration 0009)
    lifecycleState: varchar('lifecycle_state', { length: 20 })
      .notNull()
      .default('active'),
    lifecycleReason: text('lifecycle_reason'),
    lifecycleStateChangedAt: timestamp('lifecycle_state_changed_at', {
      withTimezone: true,
    }).defaultNow(),
    purgeScheduledFor: timestamp('purge_scheduled_for', { withTimezone: true }),
    lifecycleInitiatedBy: varchar('lifecycle_initiated_by', { length: 255 }),
    // PRE17B / BQR-1.1: Property processing profile + routing (migration 0006)
    countryCode: varchar('country_code', { length: 2 }),
    countrySource: text('country_source').default('organization_default'),
    timezoneSource: text('timezone_source').default('legacy'),
    timezoneResolvedAt: timestamp('timezone_resolved_at', { withTimezone: true }),
    processingRegion: text('processing_region').default('unresolved'),
    processingRegionSource: text('processing_region_source').default('country_default'),
    routingPolicyVersion: integer('routing_policy_version').notNull().default(1),
    processingRegionResolvedAt: timestamp('processing_region_resolved_at', {
      withTimezone: true,
    }),
    sourceEpoch: integer('source_epoch').notNull().default(0),
  },
  (t) => ({
    orgSlugUnique: uniqueIndex('properties_org_slug_unique')
      .on(t.organizationId, t.slug)
      .where(sql`deleted_at IS NULL`),
    // M-PROP-003: GBP place IDs must be unique within an org (CONTEXT.md invariant).
    orgGbpPlaceIdUnique: uniqueIndex('properties_org_gbp_place_id_unique')
      .on(t.organizationId, t.gbpPlaceId)
      .where(sql`gbp_place_id IS NOT NULL AND deleted_at IS NULL`),
    orgIdx: index('properties_org_idx').on(t.organizationId),
    // Migration 0006: backfill queue for unresolved processing region
    routingBackfillIdx: index('properties_routing_backfill_idx')
      .on(t.routingPolicyVersion, t.id)
      .where(sql`processing_region = 'unresolved' AND deleted_at IS NULL`),
  }),
)
