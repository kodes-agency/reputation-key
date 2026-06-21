// Goal context — Drizzle schema for goals & goal_progress tables
// Per architecture: schemas live in shared/db/schema/ because Drizzle needs a single barrel.
// snake_case columns, camelCase field names.

import {
  pgTable,
  uuid,
  varchar,
  real,
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
import { portalGroups } from './portal.schema'

export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    portalId: uuid('portal_id').references(() => portals.id, { onDelete: 'cascade' }),
    portalGroupId: uuid('portal_group_id').references(() => portalGroups.id, {
      onDelete: 'set null',
    }),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    goalType: varchar('goal_type', { length: 20 }).notNull(),
    aggregationFunction: varchar('aggregation_function', { length: 20 }).notNull(),
    metricKey: varchar('metric_key', { length: 100 }).notNull(),
    targetValue: real('target_value').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    recurrenceRule: jsonb('recurrence_rule').$type<{ frequency: string }>(),
    rollingWindowDays: integer('rolling_window_days'),
    parentGoalId: uuid('parent_goal_id'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index('goals_org_idx').on(t.organizationId),
    index('goals_org_property_idx').on(t.organizationId, t.propertyId),
    index('goals_org_status_idx').on(t.organizationId, t.status),
    index('goals_parent_idx').on(t.parentGoalId),
    index('goals_portal_group_idx').on(t.portalGroupId),
  ],
)

export const goalProgress = pgTable(
  'goal_progress',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    goalId: uuid('goal_id')
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    currentValue: real('current_value').notNull().default(0),
    currentSum: real('current_sum'),
    currentCount: integer('current_count'),
    lastComputedAt: timestamp('last_computed_at', { withTimezone: true }).notNull(),
    computedSource: varchar('computed_source', { length: 20 }).notNull(),
  },
  (t) => [
    uniqueIndex('goal_progress_goal_uniq').on(t.goalId),
    index('goal_progress_org_idx').on(t.organizationId),
  ],
)
