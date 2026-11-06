// Read latest-corrected goal counts in one statement (ADR 0068). Quarantined
// readings retain Portal/measure/day flags; suggestions omit outbox completeness,
// but running progress still uses the governed read. Count every Property reading,
// including absent, draft, disabled and deleted Portals; attribute groups at event time.
// Find each published Portal's last unretracted scan from its code date, at most
// a year back, falling back to its index only when the counted range has no scan.
// Share materialized counted rows across daily, group and recent-scan aggregates.
// Use the dashboard statement budget. The current version/event index can scan
// fleet-wide range rows; quiet-Portal fallback walks can fetch/sort a year of scans.
// A tenant/Property/version/event index would bound that work.

import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { PortalGoalMeasure } from '../../domain/goal-recommendation-types'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'
import type {
  GoalRecommendationCounts,
  GoalRecommendationCountsQuery,
} from '../../application/ports/goal-recommendation-facts.port'
import { DASHBOARD_READ_BUDGET_MS, withStatementTimeout } from '../read-facade'
import {
  correctionTipJoin,
  effectiveReadingValue,
  goalCountSpecRows,
  unreadableReading,
} from './goal-count-readings.sql'

const SCAN_VERSION = METRIC_VERSION_IDS.qualifiedScanGoal
const RATING_VERSION = METRIC_VERSION_IDS.portalRatingCountGoal

const MEASURE_BY_VERSION: ReadonlyMap<string, PortalGoalMeasure> = new Map([
  [SCAN_VERSION, 'qualified_scans'],
  [RATING_VERSION, 'portal_rating_count'],
])

type Row = Readonly<{
  row_kind: string
  portal_id: string | null
  group_id: string | null
  version_id: string | null
  local_day: string | null
  value: string | number | null
  unreadable: boolean | null
  last_scan_at: Date | string | null
}>

/** The listed Portals' lookback instants, or an empty relation when none is listed. */
function lookbackRows(query: GoalRecommendationCountsQuery): SQL {
  if (query.scanLookback.length === 0) {
    return sql`SELECT NULL::uuid AS portal_id, NULL::timestamptz AS since WHERE false`
  }
  return sql`SELECT * FROM (VALUES ${sql.join(
    query.scanLookback.map(
      (entry) => sql`(${entry.portalId}::uuid, ${entry.from}::timestamptz)`,
    ),
    sql`, `,
  )}) AS listed(portal_id, since)`
}

function countsStatement(query: GoalRecommendationCountsQuery): SQL {
  return sql`
    WITH spec(version_id, metric_key, source_policies) AS (
      VALUES ${goalCountSpecRows}
    ),
    counted AS (
      SELECT readings.portal_id,
        readings.group_id,
        spec.version_id,
        readings.event_at,
        (readings.event_at AT TIME ZONE ${query.timezone})::date AS local_day,
        ${effectiveReadingValue} AS effective_value,
        ${unreadableReading} AS unreadable
      FROM metric_readings AS readings
      JOIN spec ON spec.version_id = readings.definition_version_id
      ${correctionTipJoin}
      WHERE readings.organization_id = ${query.organizationId}
        AND readings.property_id = ${query.propertyId}::uuid
        AND readings.definition_version_id IN (${SCAN_VERSION}::uuid, ${RATING_VERSION}::uuid)
        AND readings.exact_value IS NOT NULL
        AND readings.event_at >= ${query.from}
        AND readings.event_at < ${query.to}
    ),
    days AS (
      SELECT portal_id, version_id, local_day,
        coalesce(sum(effective_value), 0) AS value,
        coalesce(
          bool_or(unreadable) FILTER (WHERE effective_value IS NOT NULL),
          false
        ) AS unreadable
      FROM counted
      GROUP BY portal_id, version_id, local_day
    ),
    -- By the group each reading was recorded with, so a Portal that moved
    -- counts in its old group before the move and in its new one after.
    group_days AS (
      SELECT group_id, version_id, local_day,
        coalesce(sum(effective_value), 0) AS value,
        coalesce(
          bool_or(unreadable) FILTER (WHERE effective_value IS NOT NULL),
          false
        ) AS unreadable
      FROM counted
      WHERE group_id IS NOT NULL
      GROUP BY group_id, version_id, local_day
    ),
    lookback AS (${lookbackRows(query)}),
    recent_scans AS (
      SELECT lookback.portal_id, max(counted.event_at) AS event_at
      FROM lookback
      JOIN counted
        ON counted.portal_id = lookback.portal_id
        AND counted.version_id = ${SCAN_VERSION}::uuid
        AND counted.effective_value IS NOT NULL
        AND counted.event_at >= lookback.since
      GROUP BY lookback.portal_id
    ),
    -- Listed Portals with no scan in the range, whose lookback reaches before it.
    quiet AS MATERIALIZED (
      SELECT lookback.portal_id, lookback.since
      FROM lookback
      WHERE lookback.since < ${query.from}
        AND NOT EXISTS (
          SELECT 1 FROM recent_scans WHERE recent_scans.portal_id = lookback.portal_id
        )
    ),
    older_scans AS (
      SELECT quiet.portal_id, older.event_at
      FROM quiet
      CROSS JOIN LATERAL (
        SELECT readings.event_at
        FROM (
          -- On the Portal's own index (organization_id, portal_id), which holds
          -- only its readings but not in time order: every reading it ever had
          -- is fetched and sorted. Portal listed it for this Property, so no
          -- Property filter is needed, and one would let the planner take the
          -- Property's index instead. The version is not "=" for the same
          -- reason: "=" lets it walk the fleet-wide (definition_version_id,
          -- event_at) index back past every other Property's scans.
          SELECT candidate.id, candidate.event_at
          FROM metric_readings AS candidate
          WHERE candidate.organization_id = ${query.organizationId}
            AND candidate.portal_id = quiet.portal_id
            AND candidate.definition_version_id IS NOT DISTINCT FROM ${SCAN_VERSION}::uuid
            AND candidate.exact_value IS NOT NULL
            AND candidate.event_at >= quiet.since
            AND candidate.event_at < ${query.from}
          ORDER BY candidate.event_at DESC
        ) AS readings
        -- Newest first, so only the scans down to the first one not retracted
        -- look up their correction, not all of them.
        ${correctionTipJoin}
        WHERE tip.kind IS DISTINCT FROM 'retract'
        ORDER BY readings.event_at DESC
        LIMIT 1
      ) AS older
    ),
    last_scans AS (
      SELECT portal_id, event_at FROM recent_scans
      UNION ALL
      SELECT portal_id, event_at FROM older_scans
    )
    SELECT 'day' AS row_kind,
      days.portal_id::text AS portal_id,
      NULL::text AS group_id,
      days.version_id::text AS version_id,
      to_char(days.local_day, 'YYYY-MM-DD') AS local_day,
      days.value::text AS value,
      days.unreadable,
      NULL::timestamptz AS last_scan_at
    FROM days
    UNION ALL
    SELECT 'group_day', NULL, group_days.group_id::text,
      group_days.version_id::text,
      to_char(group_days.local_day, 'YYYY-MM-DD'),
      group_days.value::text,
      group_days.unreadable,
      NULL::timestamptz
    FROM group_days
    UNION ALL
    SELECT 'last_scan', last_scans.portal_id::text, NULL, NULL, NULL, NULL, NULL,
      last_scans.event_at
    FROM last_scans
  `
}

/** A day's count is a whole number of at least zero; anything else is not trusted. */
function countOf(value: Row['value']): number | null {
  const count = Number(value)
  return Number.isSafeInteger(count) && count >= 0 ? count : null
}

type Counts = Readonly<{
  days: GoalRecommendationCounts['days'][number][]
  unreadable: GoalRecommendationCounts['unreadable'][number][]
  lastScanAt: Map<string, Date>
  groupDays: GoalRecommendationCounts['groupDays'][number][]
  groupUnreadable: GoalRecommendationCounts['groupUnreadable'][number][]
}>

/** A Portal's (or no Portal's) day, or a Portal Group's: its count, and whether it is trusted. */
function addDay(counts: Counts, row: Row): void {
  const measure = MEASURE_BY_VERSION.get(row.version_id ?? '')
  if (!measure || !row.local_day) return
  const localDay = row.local_day
  const count = countOf(row.value)
  const trusted = !row.unreadable && count !== null
  if (row.row_kind === 'group_day') {
    if (!row.group_id) return
    const groupId = row.group_id
    if (!trusted) counts.groupUnreadable.push({ groupId, measure, localDay })
    if (count) counts.groupDays.push({ groupId, measure, localDay, count })
    return
  }
  const portalId = row.portal_id
  if (!trusted) counts.unreadable.push({ portalId, measure, localDay })
  if (count) counts.days.push({ portalId, measure, localDay, count })
}

function countsOf(rows: readonly Row[]): GoalRecommendationCounts {
  const counts: Counts = {
    days: [],
    unreadable: [],
    lastScanAt: new Map(),
    groupDays: [],
    groupUnreadable: [],
  }
  for (const row of rows) {
    if (row.row_kind !== 'last_scan') addDay(counts, row)
    else if (row.portal_id && row.last_scan_at) {
      counts.lastScanAt.set(row.portal_id, new Date(row.last_scan_at))
    }
  }
  return counts
}

export async function readGoalRecommendationCounts(
  db: Database,
  query: GoalRecommendationCountsQuery,
): Promise<GoalRecommendationCounts> {
  const result = await withStatementTimeout(db, DASHBOARD_READ_BUDGET_MS, (tx) =>
    tx.execute(countsStatement(query)),
  )
  return countsOf(result.rows as unknown as readonly Row[])
}
