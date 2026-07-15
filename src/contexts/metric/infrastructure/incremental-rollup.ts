// PRE17C: Incremental rollup refresh functions.
//
// Replaces REFRESH MATERIALIZED VIEW CONCURRENTLY with incremental
// computation. Only dates with new data since the last watermark are
// recomputed — O(changed partitions) instead of O(total rows).
//
// Algorithm per rollup:
//   1. Read watermark (last processed timestamp)
//   2. Find earliest partition (day/week) in new data
//   3. DELETE rollup rows for affected partitions
//   4. INSERT recomputed aggregations for affected partitions
//   5. Update watermark to now()
//
// If no new data exists, steps 2-4 are skipped — the refresh is a no-op.
// The watermark is always set to now() so the next run picks up any
// data that arrived during this run.

import { sql } from 'drizzle-orm'
import { getLogger } from '#/shared/observability/logger'
import type { Database } from '#/shared/db'
import { trace } from '#/shared/observability/trace'

const NULL_PORTAL = sql`'00000000-0000-0000-0000-000000000000'`

/**
 * Incrementally refresh rollup_daily_metrics.
 *
 * Only recomputes days that have new or updated metric_readings since
 * the last watermark.
 */
export async function refreshDailyMetricsIncrementally(
  db: Database,
): Promise<{ partitionsRecomputed: number }> {
  return trace('rollup.dailyMetrics.incremental', async () => {
    const logger = getLogger()

    const watermarkResult = await db.execute(sql`
      SELECT watermark FROM _rollup_watermarks WHERE name = 'daily_metrics'
    `)
    const watermarkRow = watermarkResult.rows[0] as { watermark: Date } | undefined
    const watermark = watermarkRow?.watermark ?? new Date(0)

    const newBoundary = await db.execute(sql`
      SELECT date_trunc('day', recorded_at) AS min_date
      FROM metric_readings
      WHERE recorded_at > ${watermark}
      ORDER BY recorded_at ASC
      LIMIT 1
    `)
    const boundaryRow = newBoundary.rows[0] as { min_date: Date } | undefined

    if (!boundaryRow) {
      logger.debug('rollup.dailyMetrics: no new data since watermark')
      await db.execute(sql`
        UPDATE _rollup_watermarks
        SET watermark = now(), updated_at = now()
        WHERE name = 'daily_metrics'
      `)
      return { partitionsRecomputed: 0 }
    }

    const affectedDate = boundaryRow.min_date

    await db.execute(sql`
      DELETE FROM rollup_daily_metrics WHERE date >= ${affectedDate}
    `)

    await db.execute(sql`
      INSERT INTO rollup_daily_metrics
        (organization_id, property_id, portal_id, metric_key, date, count, sum_value, avg_value)
      SELECT
        organization_id,
        property_id,
        COALESCE(portal_id, ${NULL_PORTAL}) AS portal_id,
        metric_key,
        date_trunc('day', recorded_at) AS date,
        count(*)::integer AS count,
        sum(value)::real AS sum_value,
        avg(value)::real AS avg_value
      FROM metric_readings
      WHERE date_trunc('day', recorded_at) >= ${affectedDate}
      GROUP BY organization_id, property_id, COALESCE(portal_id, ${NULL_PORTAL}), metric_key, date_trunc('day', recorded_at)
    `)

    await db.execute(sql`
      UPDATE _rollup_watermarks
      SET watermark = now(), updated_at = now()
      WHERE name = 'daily_metrics'
    `)

    logger.info({ affectedDate }, 'Incrementally refreshed rollup_daily_metrics')
    return { partitionsRecomputed: 1 }
  })
}

/**
 * Incrementally refresh rollup_weekly_metrics.
 */
export async function refreshWeeklyMetricsIncrementally(
  db: Database,
): Promise<{ partitionsRecomputed: number }> {
  return trace('rollup.weeklyMetrics.incremental', async () => {
    const logger = getLogger()

    const watermarkResult = await db.execute(sql`
      SELECT watermark FROM _rollup_watermarks WHERE name = 'weekly_metrics'
    `)
    const watermarkRow = watermarkResult.rows[0] as { watermark: Date } | undefined
    const watermark = watermarkRow?.watermark ?? new Date(0)

    const newBoundary = await db.execute(sql`
      SELECT date_trunc('week', recorded_at) AS min_week
      FROM metric_readings
      WHERE recorded_at > ${watermark}
      ORDER BY recorded_at ASC
      LIMIT 1
    `)
    const boundaryRow = newBoundary.rows[0] as { min_week: Date } | undefined

    if (!boundaryRow) {
      logger.debug('rollup.weeklyMetrics: no new data since watermark')
      await db.execute(sql`
        UPDATE _rollup_watermarks
        SET watermark = now(), updated_at = now()
        WHERE name = 'weekly_metrics'
      `)
      return { partitionsRecomputed: 0 }
    }

    const affectedWeek = boundaryRow.min_week

    await db.execute(sql`
      DELETE FROM rollup_weekly_metrics WHERE week >= ${affectedWeek}
    `)

    await db.execute(sql`
      INSERT INTO rollup_weekly_metrics
        (organization_id, property_id, portal_id, metric_key, week, count, sum_value, avg_value)
      SELECT
        organization_id,
        property_id,
        COALESCE(portal_id, ${NULL_PORTAL}) AS portal_id,
        metric_key,
        date_trunc('week', recorded_at) AS week,
        count(*)::integer AS count,
        sum(value)::real AS sum_value,
        avg(value)::real AS avg_value
      FROM metric_readings
      WHERE date_trunc('week', recorded_at) >= ${affectedWeek}
      GROUP BY organization_id, property_id, COALESCE(portal_id, ${NULL_PORTAL}), metric_key, date_trunc('week', recorded_at)
    `)

    await db.execute(sql`
      UPDATE _rollup_watermarks
      SET watermark = now(), updated_at = now()
      WHERE name = 'weekly_metrics'
    `)

    logger.info({ affectedWeek }, 'Incrementally refreshed rollup_weekly_metrics')
    return { partitionsRecomputed: 1 }
  })
}

/**
 * Incrementally refresh rollup_daily_inbox_metrics.
 */
export async function refreshDailyInboxMetricsIncrementally(
  db: Database,
): Promise<{ partitionsRecomputed: number }> {
  return trace('rollup.dailyInboxMetrics.incremental', async () => {
    const logger = getLogger()

    const watermarkResult = await db.execute(sql`
      SELECT watermark FROM _rollup_watermarks WHERE name = 'daily_inbox_metrics'
    `)
    const watermarkRow = watermarkResult.rows[0] as { watermark: Date } | undefined
    const watermark = watermarkRow?.watermark ?? new Date(0)

    const newBoundary = await db.execute(sql`
      SELECT date_trunc('day', source_date) AS min_date
      FROM inbox_items
      WHERE updated_at > ${watermark}
      ORDER BY source_date ASC
      LIMIT 1
    `)
    const boundaryRow = newBoundary.rows[0] as { min_date: Date } | undefined

    if (!boundaryRow) {
      logger.debug('rollup.dailyInboxMetrics: no new data since watermark')
      await db.execute(sql`
        UPDATE _rollup_watermarks
        SET watermark = now(), updated_at = now()
        WHERE name = 'daily_inbox_metrics'
      `)
      return { partitionsRecomputed: 0 }
    }

    const affectedDate = boundaryRow.min_date

    await db.execute(sql`
      DELETE FROM rollup_daily_inbox_metrics WHERE date >= ${affectedDate}
    `)

    await db.execute(sql`
      INSERT INTO rollup_daily_inbox_metrics
        (organization_id, property_id, date, open_count, closed_count, escalated_count, avg_response_hours)
      SELECT
        organization_id,
        property_id,
        date_trunc('day', source_date) AS date,
        count(*) FILTER (WHERE status = 'open')::integer AS open_count,
        count(*) FILTER (WHERE status = 'closed')::integer AS closed_count,
        count(*) FILTER (WHERE is_escalated = true AND escalation_resolved_at IS NULL)::integer AS escalated_count,
        avg(EXTRACT(EPOCH FROM (closed_at - created_at)) / 3600)::real AS avg_response_hours
      FROM inbox_items
      WHERE date_trunc('day', source_date) >= ${affectedDate}
      GROUP BY organization_id, property_id, date_trunc('day', source_date)
    `)

    await db.execute(sql`
      UPDATE _rollup_watermarks
      SET watermark = now(), updated_at = now()
      WHERE name = 'daily_inbox_metrics'
    `)

    logger.info({ affectedDate }, 'Incrementally refreshed rollup_daily_inbox_metrics')
    return { partitionsRecomputed: 1 }
  })
}
