// Reporting — the one definition of a goal count reading in SQL.
//
// Two set-based reads count a Portal goal measure straight from the readings:
// the running months behind "below pace" (`goal-running-months.ts`) and the
// Monthly portal goal's recommended number (`goal-recommendation-readings.ts`).
// Both use the shared effective-reading SQL for correction values and
// these fragments for the Goal catalogue and quarantine policy.
//
// The fragments name fixed aliases: `readings` (metric_readings), `tip` (its
// latest correction, from the shared `correctionTipJoin`) and `spec` (a row of the
// `goalCountSpecRows` VALUES list: version_id, metric_key, source_policies).

import { sql, type SQL } from 'drizzle-orm'
import type { MetricKey } from '#/shared/domain/metric-keys'
import { findMetricVersionById, METRIC_VERSION_IDS } from '../../domain/metric-registry'

export type GoalCountSpec = Readonly<{
  versionId: string
  metricKey: MetricKey
  sourcePolicies: readonly string[]
}>

function countSpec(versionId: string): GoalCountSpec {
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

/** The two count measures' versions: qualified scans, then private ratings. */
export const GOAL_COUNT_SPECS: readonly GoalCountSpec[] = [
  countSpec(METRIC_VERSION_IDS.qualifiedScanGoal),
  countSpec(METRIC_VERSION_IDS.portalRatingCountGoal),
]

/** `VALUES` rows `(version_id, metric_key, source_policies)`, one per spec. */
export const goalCountSpecRows: SQL = sql.join(
  GOAL_COUNT_SPECS.map(
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

/**
 * Whether the governed read would quarantine the reading: an approximate or
 * malformed one, one from a source the measure does not allow, or one that
 * claims another measure.
 */
export const unreadableReading: SQL = sql`(
    readings.data_quality IS NULL
    OR readings.data_quality NOT IN ('exact', 'delayed', 'reconciling')
    OR readings.sample_count IS NULL
    OR readings.sample_count < 0
    OR readings.source_policy IS NULL
    OR NOT (readings.source_policy = ANY(spec.source_policies))
    OR readings.metric_key <> spec.metric_key
  )`
