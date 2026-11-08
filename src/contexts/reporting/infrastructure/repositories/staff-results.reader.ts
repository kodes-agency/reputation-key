import {
  asOfCorrectionTipJoin,
  effectiveReadingValue,
} from '../readings/effective-readings.server'
import { createStaffGoalsReader } from './staff-goals.reader'
import type {
  GovernedGoalMetricQuery,
  GovernedGoalMetricResult,
} from '../../application/use-cases/query-goal-metric'
import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { staffResultsSeries, staffResultsWindow } from '../../domain/staff-results-window'
import { PORTAL_AVERAGE_MIN_SAMPLE } from '../../domain/portal-results-thresholds'
import { METRIC_VERSION_IDS, findMetricVersionById } from '../../domain/metric-registry'
import type { StaffResultsReader } from '../../application/ports/staff-results-reader.port'

/** Only the two approved numeric measures are selectable by this reader. */
function metricPolicy(versionId: string) {
  const governed = findMetricVersionById(versionId)
  if (!governed?.version.permittedConsumers.includes('staff_self'))
    throw new Error('Staff metric consumer is not approved')
  return sql`readings.definition_version_id = ${versionId} AND readings.source_policy IN (${sql.join(
    governed.version.sourcePolicyAllowlist.map((value) => sql`${value}`),
    sql`, `,
  )}) AND readings.data_quality = 'exact' AND readings.attribution_quality <> 'unresolved'`
}

/** Correction and projection cutoff fixes a day's rating figure, including late arrivals. */
function readingsSql(
  scope: Readonly<{ organizationId: string; propertyId: string }>,
  portalIds: readonly string[],
  version: string,
  start: Date,
  end: Date,
  cutoff: Date | null,
) {
  return sql`SELECT readings.portal_id, readings.event_at, ${effectiveReadingValue} AS value
    FROM metric_readings AS readings
    ${asOfCorrectionTipJoin(cutoff)}
    WHERE readings.organization_id = ${scope.organizationId} AND readings.property_id = ${scope.propertyId}::uuid AND readings.portal_id IN (${sql.join(
      portalIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
      AND ${metricPolicy(version)} AND readings.event_at >= ${start} AND readings.event_at < ${end} AND (${cutoff}::timestamptz IS NULL OR readings.recorded_at < ${cutoff}::timestamptz)`
}

export function createStaffResultsReader(
  db: Database,
  clock: () => Date,
  queryGoal: (input: GovernedGoalMetricQuery) => Promise<GovernedGoalMetricResult>,
  targetsEnabled = false,
): StaffResultsReader {
  const reader: StaffResultsReader = {
    targetsEnabled,
    scans: async (scope, portalIds, period, now = clock()) => {
      if (portalIds.length === 0) return new Map()
      const window = staffResultsWindow(now, scope.timezone, scope.countryCode, period)
      const result = await db.execute(
        sql`SELECT portal_id, COALESCE(sum(value), 0)::int AS scans FROM (${readingsSql(scope, portalIds, METRIC_VERSION_IDS.qualifiedScanGoal, window.startAt, window.endAt, null)}) counted GROUP BY portal_id`,
      )
      const values = new Map(
        result.rows.map((row) => [String(row.portal_id), Number(row.scans)]),
      )
      return new Map(portalIds.map((id) => [id, values.get(id) ?? 0]))
    },
    results: async (scope, period) => {
      const now = clock()
      const window = staffResultsWindow(now, scope.timezone, scope.countryCode, period)
      const scans =
        (await reader.scans(scope, [scope.portalId], period, now)).get(scope.portalId) ??
        0
      if (period === 'today') return { scans, series: null }
      const days = await db.execute(
        sql`SELECT to_char(event_at AT TIME ZONE ${scope.timezone}::text, 'YYYY-MM-DD') AS day, COALESCE(sum(value), 0)::int AS scans FROM (${readingsSql(scope, [scope.portalId], METRIC_VERSION_IDS.qualifiedScanGoal, window.startAt, window.endAt, null)}) counted GROUP BY 1`,
      )
      const series = staffResultsSeries(
        now,
        scope.timezone,
        scope.countryCode,
        period,
        new Map(days.rows.map((row) => [String(row.day), Number(row.scans)])),
      )
      const ratingsEnd = period === 'last_month' ? window.endAt : window.ratingsCutoff
      const ratings = await db.execute(
        sql`SELECT count(value)::int AS count, avg(value)::float8 AS average FROM (${readingsSql(scope, [scope.portalId], METRIC_VERSION_IDS.portalRatingAnalytics, window.startAt, ratingsEnd, window.ratingsCutoff)}) counted WHERE value BETWEEN 1 AND 5 AND value = trunc(value)`,
      )
      const count = Number(ratings.rows[0]?.count ?? 0)
      return {
        scans,
        series,
        ratingCount: count,
        ...(count >= PORTAL_AVERAGE_MIN_SAMPLE
          ? { averageRating: Number(ratings.rows[0]?.average) }
          : {}),
        ratingsCutoff: window.ratingsCutoff.toISOString(),
      }
    },
    goals: async (scope) =>
      targetsEnabled ? createStaffGoalsReader(db, clock, queryGoal)(scope) : [],
  }
  return reader
}
