import { createStaffGoalsReader } from './staff-goals.reader'
import type {
  GovernedGoalMetricQuery,
  GovernedGoalMetricResult,
} from '../../application/use-cases/query-goal-metric'
import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { staffResultsWindow } from '../../domain/staff-results-window'
import { PORTAL_AVERAGE_MIN_SAMPLE } from '../../domain/portal-results-thresholds'
import { METRIC_VERSION_IDS, findMetricVersionById } from '../../domain/metric-registry'
import type { StaffResultsReader } from '../../application/ports/staff-results-reader.port'

/** Only the two approved numeric measures are selectable by this reader. */
function metricPolicy(versionId: string) {
  const governed = findMetricVersionById(versionId)
  if (!governed?.version.permittedConsumers.includes('staff_self'))
    throw new Error('Staff metric consumer is not approved')
  return sql`r.definition_version_id = ${versionId} AND r.source_policy IN (${sql.join(
    governed.version.sourcePolicyAllowlist.map((value) => sql`${value}`),
    sql`, `,
  )}) AND r.data_quality = 'exact' AND r.attribution_quality <> 'unresolved'`
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
  return sql`SELECT r.portal_id, CASE WHEN c.kind = 'retract' THEN NULL WHEN c.kind = 'replace' THEN c.replacement_value WHEN c.kind = 'adjust' THEN r.exact_value + c.exact_delta ELSE r.exact_value END AS value
    FROM metric_readings r
    LEFT JOIN LATERAL (SELECT kind, replacement_value, exact_delta FROM metric_corrections c WHERE c.reading_id = r.id AND (${cutoff}::timestamptz IS NULL OR c.recorded_at < ${cutoff}::timestamptz) ORDER BY c.recorded_at DESC, c.id DESC LIMIT 1) c ON true
    WHERE r.organization_id = ${scope.organizationId} AND r.property_id = ${scope.propertyId}::uuid AND r.portal_id IN (${sql.join(
      portalIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
      AND ${metricPolicy(version)} AND r.event_at >= ${start} AND r.event_at < ${end} AND (${cutoff}::timestamptz IS NULL OR r.recorded_at < ${cutoff}::timestamptz)`
}

export function createStaffResultsReader(
  db: Database,
  clock: () => Date,
  queryGoal: (input: GovernedGoalMetricQuery) => Promise<GovernedGoalMetricResult>,
  targetsEnabled = false,
): StaffResultsReader {
  const reader: StaffResultsReader = {
    targetsEnabled,
    scans: async (scope, portalIds, period) => {
      if (portalIds.length === 0) return new Map()
      const window = staffResultsWindow(
        clock(),
        scope.timezone,
        scope.countryCode,
        period,
      )
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
        (await reader.scans(scope, [scope.portalId], period)).get(scope.portalId) ?? 0
      if (period === 'today') return { scans }
      const ratings = await db.execute(
        sql`SELECT count(value)::int AS count, avg(value)::float8 AS average FROM (${readingsSql(scope, [scope.portalId], METRIC_VERSION_IDS.portalRatingAnalytics, window.startAt, window.ratingsCutoff, window.ratingsCutoff)}) counted WHERE value BETWEEN 1 AND 5 AND value = trunc(value)`,
      )
      const count = Number(ratings.rows[0]?.count ?? 0)
      return {
        scans,
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
