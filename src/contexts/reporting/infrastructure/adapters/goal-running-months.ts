// Reporting — the count goals whose month is running, with the figure each has
// reached so far.
//
// "Behind pace" needs the live month to date, and a month still running holds
// none: its result row stays `updating` with no value until the month closes.
// So the figure is counted here, from the governed readings, for every running
// month of an active count goal in one statement, however many goals and
// Properties the scope holds. The rule that turns a figure into "behind pace"
// is `goalsBehindPaceByProperty` (domain/goal-pace.ts); this only supplies what
// it is applied to.
//
// The sum is the one a goal's own page reads (`queryGoalAggregate`): the readings
// of the goal's measure inside the month, for its subject, each at its latest
// correction. So is whether the goal can be read at all: a subject that was
// deleted (a Portal or Portal Group), and a metric version that is not in effect
// for the whole month, make the page say it cannot be read, so they are not
// counted here either (`goalVersionIsUsable` is the page's own rule). The one
// slow half of that read left out is the proof from the outbox that the month's
// facts have all been applied: it is a completeness check for a result, and a
// nudge needs only the count. A month with a reading that read would quarantine
// (an approximate or malformed one, one from a source the measure does not
// allow) comes back without a figure and is not counted, as the page would show
// it as unreadable.

import { sql, type SQL } from 'drizzle-orm'
import type { Tx } from '#/shared/db'
import type { OrganizationId } from '#/shared/domain/ids'
import type { MetricKey } from '#/shared/domain/metric-keys'
import { findMetricVersionById, METRIC_VERSION_IDS } from '../../domain/metric-registry'
import type { MetricScope } from '../../domain/metric-registry'
import { goalVersionIsUsable } from '../../domain/goal-metric-version-usable'
import type { RunningCountMonth } from '../../domain/goal-pace'

type CountMetric = RunningCountMonth['metric']

type CountSpec = Readonly<{
  versionId: string
  metricKey: MetricKey
  sourcePolicies: readonly string[]
}>

function countSpec(versionId: string): CountSpec {
  const governed = findMetricVersionById(versionId)
  if (!governed || !governed.version.permittedConsumers.includes('goal')) {
    throw new Error(`Goal count metric is unavailable: ${versionId}`)
  }
  return {
    versionId,
    metricKey: governed.definition.key,
    sourcePolicies: governed.version.sourcePolicyAllowlist,
  }
}

const COUNT_SPECS: readonly CountSpec[] = [
  countSpec(METRIC_VERSION_IDS.qualifiedScanGoal),
  countSpec(METRIC_VERSION_IDS.portalRatingCountGoal),
]

const SPEC_BY_VERSION: ReadonlyMap<string, CountSpec> = new Map(
  COUNT_SPECS.map((spec) => [spec.versionId, spec]),
)

const specRows = sql.join(
  COUNT_SPECS.map(
    (spec) => sql`(
      ${spec.versionId}::uuid,
      ${spec.metricKey}::text,
      ARRAY[${sql.join(
        spec.sourcePolicies.map((policy) => sql`${policy}`),
        sql`, `,
      )}]::text[]
    )`,
  ),
  sql`, `,
)

export type RunningCountMonthsScope = Readonly<{
  organizationId: OrganizationId
  /** A condition on `results.property_id`: one Property, or the ones in scope. */
  properties: SQL
  now: Date
}>

type Row = Readonly<{
  property_id: string
  program_id: string
  metric_key: string
  version_id: string
  subject_kind: string
  period_start: Date | string
  period_end: Date | string
  timezone: string
  target_value: string | number
  value: string | number | null
}>

const toDate = (value: Date | string): Date =>
  value instanceof Date ? value : new Date(value)

function isCountMetric(metricKey: string): metricKey is CountMetric {
  return metricKey === 'qualified_scans' || metricKey === 'portal_rating_count'
}

/** A count is a whole number of at least zero; anything else is not a figure. */
function figureOf(value: string | number | null): number | null {
  if (value === null) return null
  const count = Number(value)
  return Number.isInteger(count) && count >= 0 ? count : null
}

const isMetricScope = (kind: string): kind is MetricScope =>
  kind === 'property' || kind === 'portal_group' || kind === 'portal'

/** Whether the governed version may answer for this month, as the goal's page asks it. */
function versionIsUsable(row: Row, period: RunningCountMonth['period']): boolean {
  const spec = SPEC_BY_VERSION.get(row.version_id)
  const governed = findMetricVersionById(row.version_id)
  if (!spec || !governed || !isMetricScope(row.subject_kind)) return false
  return goalVersionIsUsable(governed, {
    metricKey: spec.metricKey,
    subjectKind: row.subject_kind,
    periodStart: period.start,
    periodEnd: period.end,
  })
}

function monthOf(row: Row): RunningCountMonth | null {
  const target = Number(row.target_value)
  if (!isCountMetric(row.metric_key) || !Number.isFinite(target) || target <= 0) {
    return null
  }
  const period = { start: toDate(row.period_start), end: toDate(row.period_end) }
  if (!versionIsUsable(row, period)) return null
  return {
    propertyId: row.property_id,
    programId: row.program_id,
    metric: row.metric_key,
    period,
    timezone: row.timezone,
    target,
    value: figureOf(row.value),
  }
}

/**
 * Every running month of an active count goal in scope, with its month to date.
 * A month is running while its row is `open` and `now` is inside its period; a
 * paused or ended goal has none that counts.
 */
export async function readRunningCountMonths(
  tx: Pick<Tx, 'execute'>,
  scope: RunningCountMonthsScope,
): Promise<readonly RunningCountMonth[]> {
  const result = await tx.execute(runningCountMonthsQuery(scope))
  return (result.rows as unknown as readonly Row[]).flatMap((row) => {
    const month = monthOf(row)
    return month ? [month] : []
  })
}

/** One statement for every running month in scope, however many goals hold them. */
function runningCountMonthsQuery(scope: RunningCountMonthsScope): SQL {
  return sql`
    WITH running AS MATERIALIZED (
      SELECT results.organization_id,
        results.property_id,
        results.program_id,
        results.period_start,
        results.period_end,
        results.property_timezone AS timezone,
        coalesce(results.target_value, versions.target_value) AS target_value,
        versions.metric_key,
        versions.metric_definition_version_id,
        assignments.subject_kind,
        assignments.portal_group_id,
        assignments.portal_id
      FROM goal_monthly_results AS results
      JOIN goal_programs AS programs
        ON programs.organization_id = results.organization_id
        AND programs.property_id = results.property_id
        AND programs.id = results.program_id
      JOIN goal_program_versions AS versions
        ON versions.organization_id = results.organization_id
        AND versions.property_id = results.property_id
        AND versions.program_id = results.program_id
        AND versions.id = results.program_version_id
      JOIN goal_subject_assignments AS assignments
        ON assignments.organization_id = results.organization_id
        AND assignments.property_id = results.property_id
        AND assignments.program_id = results.program_id
        AND assignments.program_version_id = results.program_version_id
        AND assignments.id = results.assignment_id
      WHERE results.organization_id = ${scope.organizationId}
        AND ${scope.properties}
        AND programs.status = 'active'
        AND results.status = 'open'
        AND results.period_start <= ${scope.now}
        AND results.period_end > ${scope.now}
        AND versions.metric_key IN ('qualified_scans', 'portal_rating_count')
        AND (
          (assignments.subject_kind = 'property'
            AND assignments.property_subject_id = results.property_id)
          OR (assignments.subject_kind = 'portal' AND EXISTS (
            SELECT 1 FROM portals
            WHERE portals.id = assignments.portal_id
              AND portals.organization_id = results.organization_id
              AND portals.property_id = results.property_id
              AND portals.deleted_at IS NULL
          ))
          OR (assignments.subject_kind = 'portal_group' AND EXISTS (
            SELECT 1 FROM portal_groups
            WHERE portal_groups.id = assignments.portal_group_id
              AND portal_groups.organization_id = results.organization_id
              AND portal_groups.property_id = results.property_id
              AND portal_groups.deleted_at IS NULL
          ))
        )
    )
    SELECT running.property_id::text AS property_id,
      running.program_id::text AS program_id,
      running.metric_key,
      running.metric_definition_version_id::text AS version_id,
      running.subject_kind,
      running.period_start,
      running.period_end,
      running.timezone,
      running.target_value,
      CASE WHEN live.unreadable THEN NULL ELSE live.value END AS value
    FROM running
    JOIN (VALUES ${specRows}) AS spec(version_id, metric_key, source_policies)
      ON spec.version_id = running.metric_definition_version_id
    CROSS JOIN LATERAL (
      SELECT coalesce(sum(counted.effective_value), 0) AS value,
        coalesce(
          bool_or(counted.unreadable) FILTER (WHERE counted.effective_value IS NOT NULL),
          false
        ) AS unreadable
      FROM (
        SELECT CASE tip.kind
            WHEN 'retract' THEN NULL
            WHEN 'replace' THEN tip.replacement_value
            WHEN 'adjust' THEN readings.exact_value + tip.exact_delta
            ELSE readings.exact_value
          END AS effective_value,
          (
            readings.data_quality IS NULL
            OR readings.data_quality NOT IN ('exact', 'delayed', 'reconciling')
            OR readings.sample_count IS NULL
            OR readings.sample_count < 0
            OR readings.source_policy IS NULL
            OR NOT (readings.source_policy = ANY(spec.source_policies))
            OR readings.metric_key <> spec.metric_key
          ) AS unreadable
        FROM metric_readings AS readings
        LEFT JOIN metric_corrections AS tip
          ON tip.reading_id = readings.id
          AND NOT EXISTS (
            SELECT 1 FROM metric_corrections AS successor
            WHERE successor.supersedes_correction_id = tip.id
          )
        WHERE readings.organization_id = running.organization_id
          AND readings.property_id = running.property_id
          AND readings.definition_version_id = running.metric_definition_version_id
          AND readings.exact_value IS NOT NULL
          AND readings.event_at >= running.period_start
          AND readings.event_at < running.period_end
          AND (
            running.subject_kind = 'property'
            OR (running.subject_kind = 'portal_group'
              AND readings.group_id = running.portal_group_id)
            OR (running.subject_kind = 'portal'
              AND readings.portal_id = running.portal_id)
          )
      ) AS counted
    ) AS live
  `
}
