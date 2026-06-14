// Leaderboard context — Drizzle schema for leaderboard snapshots and entries.
// Per architecture: schemas live in shared/db/schema/ because Drizzle needs a single barrel.
// snake_case columns, camelCase field names.

import {
  pgTable,
  uuid,
  varchar,
  integer,
  real,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { createdAtColumn } from '../columns'
import { properties } from './property.schema'

export const leaderboardSnapshots = pgTable(
  'leaderboard_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: varchar('property_id', { length: 255 })
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    period: varchar('period', { length: 30 }).notNull(),
    scope: varchar('scope', { length: 20 }).notNull(),
    metricKey: varchar('metric_key', { length: 100 }).notNull(),
    scoreKey: varchar('score_key', { length: 100 }).notNull().default('overall'),
    lastUpdatedAt: timestamp('last_updated_at', { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex('leaderboard_snapshots_key_unique').on(
      t.propertyId,
      t.period,
      t.scope,
      t.metricKey,
      t.scoreKey,
    ),
    index('leaderboard_snapshots_property_idx').on(t.propertyId),
  ],
)

export const leaderboardEntries = pgTable(
  'leaderboard_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    snapshotId: uuid('snapshot_id')
      .notNull()
      .references(() => leaderboardSnapshots.id, { onDelete: 'cascade' }),
    rank: integer('rank').notNull(),
    targetType: varchar('target_type', { length: 20 }).notNull(),
    targetId: uuid('target_id').notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: varchar('property_id', { length: 255 })
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    score: real('score').notNull(),
    metricValue: real('metric_value').notNull(),
    normalizedScore: real('normalized_score').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index('leaderboard_entries_snapshot_rank_idx').on(t.snapshotId, t.rank),
    index('leaderboard_entries_target_idx').on(t.targetType, t.targetId),
  ],
)
