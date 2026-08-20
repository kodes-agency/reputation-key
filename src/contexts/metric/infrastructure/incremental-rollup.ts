// PRE17C: Incremental rollup refresh functions.
//
// Replaces REFRESH MATERIALIZED VIEW CONCURRENTLY with incremental
// computation. Only dates with new data since the last watermark are
// recomputed — O(changed partitions) instead of O(total rows).
//
// Algorithm per rollup:
//   1. Capture the database clock, THEN read the watermark
//   2. Find earliest partition (day/week) in data newer than the watermark
//   3. DELETE rollup rows for affected partitions
//   4. INSERT recomputed aggregations for affected partitions
//   5. Advance the watermark to the instant captured in step 1
//
// If no new data exists, steps 3-4 are skipped — the refresh is a no-op.
// The captured instant, NOT a fresh now(), is what the watermark advances to.
// Advancing to a now() evaluated inside the final UPDATE permanently dropped
// rows: a reading inserted between the boundary SELECT and that UPDATE is
// greater than the old watermark and less than the new one, so the next run's
// `WHERE recorded_at > watermark` never saw it and its day partition was never
// recomputed. That is the divergence that made live analytics reads disagree
// permanently with the rollup-backed goals/badges/leaderboards. Capturing
// first makes such a reading land strictly after the watermark, so the next
// run recomputes its partition.

import { sql } from 'drizzle-orm'
import { getLogger } from '#/shared/observability/logger'
import type { Database } from '#/shared/db'
import { trace } from '#/shared/observability/trace'

const NULL_PORTAL = sql`'00000000-0000-0000-0000-000000000000'`

/**
 * Capture the database clock and read the rollup watermark and the earliest
 * partition boundary in data that arrived after it (BQC-5.9 E18). Returns a
 * null boundary when no new data exists — the caller then bumps the watermark
 * and no-ops. `capturedAt` is read in the SAME statement as the watermark and
 * therefore strictly BEFORE the boundary SELECT, so nothing written during
 * this run can be skipped by the next one. The watermark/boundary SQL is raw
 * because _rollup_watermarks is a migration-owned ops table outside the
 * drizzle schema; identifiers are internal constants interpolated via sql.raw.
 */
async function readWatermarkBoundary(
  db: Database,
  opts: Readonly<{
    name: string
    partitionUnit: 'day' | 'week'
    sourceTable: string
    dateColumn: string
    watermarkColumn: string
  }>,
): Promise<{ capturedAt: Date; boundary: Date | null }> {
  const watermarkResult = await db.execute(sql`
    SELECT
      now() AS captured_at,
      (SELECT watermark FROM _rollup_watermarks WHERE name = ${opts.name}) AS watermark
  `)
  const watermarkRow = watermarkResult.rows[0] as
    | { captured_at: Date; watermark: Date | null }
    | undefined
  if (!watermarkRow) throw new Error('rollup: could not read the database clock')
  const watermark = watermarkRow.watermark ?? new Date(0)

  const newBoundary = await db.execute(sql`
    SELECT date_trunc(${sql.raw(`'${opts.partitionUnit}'`)}, ${sql.raw(opts.dateColumn)}) AS min_partition
    FROM ${sql.raw(opts.sourceTable)}
    WHERE ${sql.raw(opts.watermarkColumn)} > ${watermark}
    ORDER BY ${sql.raw(opts.dateColumn)} ASC
    LIMIT 1
  `)
  const boundaryRow = newBoundary.rows[0] as { min_partition: Date } | undefined

  return {
    capturedAt: watermarkRow.captured_at,
    boundary: boundaryRow?.min_partition ?? null,
  }
}

/** Advance a rollup watermark to the instant captured before the boundary read
 *  (after a refresh, or after a no-data no-op). The captured timestamp
 *  round-trips through a JS Date, so it can land up to 999µs BEFORE the true
 *  server instant — an error in the safe direction: the next run may recompute
 *  a partition twice (the refresh is DELETE+INSERT idempotent) but can never
 *  skip a row. */
async function advanceWatermark(db: Database, name: string, to: Date): Promise<void> {
  await db.execute(sql`
    UPDATE _rollup_watermarks
    SET watermark = ${to}, updated_at = now()
    WHERE name = ${name}
  `)
}

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

    const { capturedAt, boundary: affectedDate } = await readWatermarkBoundary(db, {
      name: 'daily_metrics',
      partitionUnit: 'day',
      sourceTable: 'metric_readings',
      dateColumn: 'recorded_at',
      watermarkColumn: 'recorded_at',
    })

    if (!affectedDate) {
      logger.debug('rollup.dailyMetrics: no new data since watermark')
      await advanceWatermark(db, 'daily_metrics', capturedAt)
      return { partitionsRecomputed: 0 }
    }

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

    await advanceWatermark(db, 'daily_metrics', capturedAt)

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

    const { capturedAt, boundary: affectedWeek } = await readWatermarkBoundary(db, {
      name: 'weekly_metrics',
      partitionUnit: 'week',
      sourceTable: 'metric_readings',
      dateColumn: 'recorded_at',
      watermarkColumn: 'recorded_at',
    })

    if (!affectedWeek) {
      logger.debug('rollup.weeklyMetrics: no new data since watermark')
      await advanceWatermark(db, 'weekly_metrics', capturedAt)
      return { partitionsRecomputed: 0 }
    }

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

    await advanceWatermark(db, 'weekly_metrics', capturedAt)

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

    const { capturedAt, boundary: affectedDate } = await readWatermarkBoundary(db, {
      name: 'daily_inbox_metrics',
      partitionUnit: 'day',
      sourceTable: 'inbox_items',
      dateColumn: 'source_date',
      watermarkColumn: 'updated_at',
    })

    if (!affectedDate) {
      logger.debug('rollup.dailyInboxMetrics: no new data since watermark')
      await advanceWatermark(db, 'daily_inbox_metrics', capturedAt)
      return { partitionsRecomputed: 0 }
    }

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

    await advanceWatermark(db, 'daily_inbox_metrics', capturedAt)

    logger.info({ affectedDate }, 'Incrementally refreshed rollup_daily_inbox_metrics')
    return { partitionsRecomputed: 1 }
  })
}
