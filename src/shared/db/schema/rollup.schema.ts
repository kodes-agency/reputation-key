// Incremental rollup tables (migration 0008 / PRE17C).
// Canonical Drizzle model matching the migrated DB. Jobs may still use raw SQL
// until a typed cutover; this removes the dual-truth (SQL exists, Drizzle silent).

import { sql } from 'drizzle-orm'
import { pgTable, text, timestamp, integer, real, primaryKey } from 'drizzle-orm/pg-core'

const NULL_PORTAL_ID = '00000000-0000-0000-0000-000000000000'

export const rollupDailyMetrics = pgTable(
  'rollup_daily_metrics',
  {
    organizationId: text('organization_id').notNull(),
    propertyId: text('property_id').notNull(),
    portalId: text('portal_id').notNull().default(NULL_PORTAL_ID),
    metricKey: text('metric_key').notNull(),
    date: timestamp('date', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
    sumValue: real('sum_value').notNull().default(0),
    avgValue: real('avg_value').notNull().default(0),
  },
  (t) => [
    primaryKey({
      columns: [t.organizationId, t.propertyId, t.portalId, t.metricKey, t.date],
    }),
  ],
)

export const rollupWeeklyMetrics = pgTable(
  'rollup_weekly_metrics',
  {
    organizationId: text('organization_id').notNull(),
    propertyId: text('property_id').notNull(),
    portalId: text('portal_id').notNull().default(NULL_PORTAL_ID),
    metricKey: text('metric_key').notNull(),
    week: timestamp('week', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
    sumValue: real('sum_value').notNull().default(0),
    avgValue: real('avg_value').notNull().default(0),
  },
  (t) => [
    primaryKey({
      columns: [t.organizationId, t.propertyId, t.portalId, t.metricKey, t.week],
    }),
  ],
)

export const rollupDailyInboxMetrics = pgTable(
  'rollup_daily_inbox_metrics',
  {
    organizationId: text('organization_id').notNull(),
    propertyId: text('property_id').notNull(),
    date: timestamp('date', { withTimezone: true }).notNull(),
    openCount: integer('open_count').notNull().default(0),
    closedCount: integer('closed_count').notNull().default(0),
    escalatedCount: integer('escalated_count').notNull().default(0),
    avgResponseHours: real('avg_response_hours'),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.propertyId, t.date] })],
)

/** Watermark per rollup name for incremental refresh. */
export const rollupWatermarks = pgTable('_rollup_watermarks', {
  name: text('name').primaryKey(),
  watermark: timestamp('watermark', { withTimezone: true })
    .notNull()
    .default(sql`'1970-01-01'::timestamptz`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
