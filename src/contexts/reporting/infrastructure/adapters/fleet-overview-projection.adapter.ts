import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { propertyId } from '#/shared/domain/ids'
import {
  METRIC_VERSION_IDS,
  findMetricVersionById,
  type GovernedMetricVersion,
} from '../../domain/metric-registry'
import type {
  FleetMetricEvidence,
  FleetMetricFreshness,
} from '../../domain/dashboard-types'
import type {
  FleetOverviewProjectionPort,
  FleetOverviewProjectionRow,
} from '../../application/ports/fleet-overview-projection.port'
import { FLEET_PAGE_SIZE } from '../../application/ports/fleet-overview-projection.port'
import { RATING_DROP_THRESHOLD } from '../../application/utils'
import { MIN_RATING_COMPARISON_SAMPLE } from '../../domain/portal-results-thresholds'
import { goalsBehindPaceByProperty } from '../../domain/goal-pace'
import type { RatingGoalMode, RatingGoalStatus } from '../../domain/rating-goal'
import { DASHBOARD_READ_BUDGET_MS, withStatementTimeout } from '../read-facade'
import { readRunningCountMonths } from './goal-running-months'

const FRESHNESS_WINDOW_MS = 48 * 60 * 60 * 1_000
type FleetMetricPolicy = Readonly<{
  metric: GovernedMetricVersion
  sourcePolicies: SQL
}>

function fleetMetricPolicy(
  versionId: string,
  consumer: 'dashboard' | 'portal_analytics',
): FleetMetricPolicy {
  const metric = findMetricVersionById(versionId)
  if (!metric || !metric.version.permittedConsumers.includes(consumer)) {
    throw new Error(`Fleet metric catalogue entry is unavailable: ${versionId}`)
  }
  return Object.freeze({
    metric,
    sourcePolicies: sql.join(
      metric.version.sourcePolicyAllowlist.map((policy) => sql`${policy}`),
      sql`, `,
    ),
  })
}

const PROPERTY_REVIEW_POLICY = fleetMetricPolicy(
  METRIC_VERSION_IDS.propertyReviewDashboard,
  'dashboard',
)
const PORTAL_SCAN_POLICY = fleetMetricPolicy(
  METRIC_VERSION_IDS.portalScanAnalytics,
  'portal_analytics',
)
const PORTAL_FEEDBACK_POLICY = fleetMetricPolicy(
  METRIC_VERSION_IDS.portalFeedbackAnalytics,
  'portal_analytics',
)

export type FleetOverviewProjectionInstrumentation = Readonly<{
  onRead(
    value: Readonly<{
      propertyCount: number
      returnedRows: number
      /** Actual wall-clock duration of the bounded projection read. */
      durationMs: number
    }>,
  ): void
}>

type MainRow = Readonly<{
  property_id: string | null
  name: string | null
  cursor_lower_name: string | null
  slug: string | null
  timezone: string | null
  period_start: Date | string | null
  period_end: Date | string | null
  review_count: string | number | null
  prior_review_count: string | number | null
  avg_rating: string | number | null
  prior_avg_rating: string | number | null
  scan_count: string | number | null
  feedback_count: string | number | null
  property_count: string | number
  rating_sample_count: string | number
  overall_avg_rating: string | number
  rating_drop_total: string | number
  has_more: boolean
  portal_enabled: boolean | null
  review_total_count: string | number | null
  review_watermark: Date | string | null
  review_correction_count: string | number | null
  review_source_policies: readonly string[] | null
  scan_eligible_count: string | number | null
  scan_total_count: string | number | null
  scan_watermark: Date | string | null
  scan_correction_count: string | number | null
  scan_source_policies: readonly string[] | null
  feedback_eligible_count: string | number | null
  feedback_total_count: string | number | null
  feedback_watermark: Date | string | null
  feedback_correction_count: string | number | null
  feedback_source_policies: readonly string[] | null
  items_to_triage: string | number | null
  escalated: string | number | null
  needs_attention: string | number | null
  total_attention_work: string | number
  lifecycle_active: boolean | null
  google_binding_active: boolean | null
  google_review_count: string | number | null
  google_average_rating: string | number | null
  google_verified_at: Date | string | null
  rating_goal_mode: string | null
  rating_goal_target_tenths: string | number | null
  rating_goal_status: string | null
}>

const numeric = (value: string | number | null | undefined): number =>
  Number(value ?? 0) || 0

function dateValue(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function requiredDateValue(value: Date | string | null | undefined): Date {
  const date = dateValue(value)
  if (!date) throw new Error('Fleet projection returned an invalid period boundary')
  return date
}

/** Google's own numbers at the Property's current binding, when it sent any. */
function googleOf(row: MainRow): FleetOverviewProjectionRow['google'] {
  const verifiedAt = dateValue(row.google_verified_at)
  if (row.google_review_count == null || verifiedAt === null) return null
  return {
    reviewCount: numeric(row.google_review_count),
    averageRating:
      row.google_average_rating == null ? null : Number(row.google_average_rating),
    verifiedAt,
    bindingActive: row.google_binding_active === true,
  }
}

/** The active rating goal as stored; never evaluated here. */
function ratingGoalOf(row: MainRow): FleetOverviewProjectionRow['ratingGoal'] {
  if (row.rating_goal_mode == null || row.rating_goal_target_tenths == null) {
    return null
  }
  return {
    mode: row.rating_goal_mode as RatingGoalMode,
    targetTenths: numeric(row.rating_goal_target_tenths),
    lastStatus: (row.rating_goal_status ?? null) as RatingGoalStatus | null,
  }
}

function freshness(
  eligibleCount: number,
  watermark: Date | null,
  now: Date,
): FleetMetricFreshness {
  if (eligibleCount === 0 || watermark === null) return 'insufficient_data'
  return now.getTime() - watermark.getTime() > FRESHNESS_WINDOW_MS ? 'stale' : 'fresh'
}

function evidence(input: {
  definitionVersionId: string
  periodStart: Date
  periodEnd: Date
  timezone: string
  sourcePolicies: readonly string[] | null
  watermark: Date | string | null
  eligibleCount: number
  totalCount: number
  correctionCount: number
  now: Date
}): FleetMetricEvidence {
  const watermark = dateValue(input.watermark)
  return {
    definitionVersionId: input.definitionVersionId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    timezone: input.timezone,
    sourcePolicies: [...(input.sourcePolicies ?? [])].sort(),
    watermark,
    freshness: freshness(input.eligibleCount, watermark, input.now),
    completeness:
      input.totalCount === 0
        ? 0
        : Math.min(1, Math.max(0, input.eligibleCount / input.totalCount)),
    correctionCount: input.correctionCount,
  }
}

export const createFleetOverviewProjectionAdapter = (
  db: Database,
  instrumentation?: FleetOverviewProjectionInstrumentation,
): FleetOverviewProjectionPort => ({
  async read(input) {
    const readStartedAt = performance.now()
    const cursorName = input.cursor?.lowerName ?? null
    const cursorId = input.cursor?.propertyId ?? null
    const comparisonAvailable = input.periodDays !== null
    const candidateWindowDays = input.periodDays === null ? null : input.periodDays * 2
    const accessFilter =
      input.accessiblePropertyIds === null
        ? sql`TRUE`
        : input.accessiblePropertyIds.length === 0
          ? sql`FALSE`
          : sql`properties.id IN (${sql.join(
              input.accessiblePropertyIds.map((id) => sql`${id}::uuid`),
              sql`, `,
            )})`
    // Read capabilities are organization-wide, so they stay statement constants
    // rather than a per-Property CTE the statement would have to join.
    const portalEnabled = sql`${input.portalReadEnabled}::boolean`
    const goalEnabled = sql`${input.goalReadEnabled}::boolean`

    const { mainResult, goalMonths } = await withStatementTimeout(
      db,
      DASHBOARD_READ_BUDGET_MS,
      async (tx) => {
        const mainResult = await tx.execute(sql`
          WITH scoped_properties AS MATERIALIZED (
            SELECT properties.id AS property_id,
              properties.name,
              properties.slug,
              properties.timezone,
              properties.source_epoch,
              properties.lifecycle_state,
              properties.google_binding_state,
              CASE WHEN ${input.periodDays}::integer IS NULL
                THEN to_timestamp(0)
                ELSE (
                  (${input.now}::timestamptz AT TIME ZONE properties.timezone)
                  - make_interval(days => ${input.periodDays}::integer)
                ) AT TIME ZONE properties.timezone
              END AS period_start,
              ${input.now}::timestamptz AS period_end,
              CASE WHEN ${candidateWindowDays}::integer IS NULL
                THEN to_timestamp(0)
                ELSE (
                  (${input.now}::timestamptz AT TIME ZONE properties.timezone)
                  - make_interval(days => ${candidateWindowDays}::integer)
                ) AT TIME ZONE properties.timezone
              END AS prior_start
            FROM properties
            WHERE properties.organization_id = ${input.organizationId}
              AND properties.deleted_at IS NULL
              -- The workspace: a removed Property (archived and later) is listed
              -- apart, with no figures, so it takes no page slot and no total.
              AND properties.lifecycle_state IN ('active', 'suspended')
              AND ${accessFilter}
          ), scoped AS MATERIALIZED (
            SELECT scoped_properties.*,
              scoped_properties.period_start AS prior_end
            FROM scoped_properties
          ), candidate_readings AS MATERIALIZED (
            -- Each reading carries its Property's windows, so no later step joins
            -- back to scoped. CTE scans have no statistics: a nested loop between
            -- two Property-sized CTEs is quadratic in the fleet.
            SELECT metric_readings.*,
              scoped.period_start,
              scoped.period_end,
              scoped.prior_start,
              scoped.prior_end
            FROM metric_readings
            JOIN scoped
              ON scoped.property_id = metric_readings.property_id
            WHERE metric_readings.organization_id = ${input.organizationId}
              AND (
                (
                  metric_readings.definition_version_id =
                    ${PROPERTY_REVIEW_POLICY.metric.version.id}
                  AND metric_readings.source_policy IN (
                    ${PROPERTY_REVIEW_POLICY.sourcePolicies}
                  )
                )
                OR (
                  metric_readings.definition_version_id =
                    ${PORTAL_SCAN_POLICY.metric.version.id}
                  AND metric_readings.source_policy IN (
                    ${PORTAL_SCAN_POLICY.sourcePolicies}
                  )
                )
                OR (
                  metric_readings.definition_version_id =
                    ${PORTAL_FEEDBACK_POLICY.metric.version.id}
                  AND metric_readings.source_policy IN (
                    ${PORTAL_FEEDBACK_POLICY.sourcePolicies}
                  )
                )
              )
              AND metric_readings.event_at >= scoped.prior_start
              AND metric_readings.event_at < scoped.period_end
          ), correction_history AS MATERIALIZED (
            SELECT metric_corrections.reading_id, count(*) AS correction_count
            FROM metric_corrections
            JOIN candidate_readings
              ON candidate_readings.id = metric_corrections.reading_id
            GROUP BY metric_corrections.reading_id
          ), leaf_corrections AS MATERIALIZED (
            SELECT DISTINCT ON (metric_corrections.reading_id)
              metric_corrections.reading_id,
              metric_corrections.kind,
              metric_corrections.exact_delta,
              metric_corrections.replacement_value
            FROM metric_corrections
            JOIN candidate_readings
              ON candidate_readings.id = metric_corrections.reading_id
            WHERE NOT EXISTS (
              SELECT 1 FROM metric_corrections successor
              WHERE successor.supersedes_correction_id = metric_corrections.id
            )
            ORDER BY metric_corrections.reading_id,
              metric_corrections.recorded_at DESC,
              metric_corrections.id DESC
          ), effective_readings AS MATERIALIZED (
            SELECT candidate_readings.*,
              coalesce(correction_history.correction_count, 0) AS correction_count,
              CASE leaf_corrections.kind
                WHEN 'retract' THEN NULL
                WHEN 'replace' THEN leaf_corrections.replacement_value
                WHEN 'adjust' THEN candidate_readings.exact_value + leaf_corrections.exact_delta
                ELSE candidate_readings.exact_value
              END AS effective_value,
              candidate_readings.data_quality = 'exact'
                AND candidate_readings.attribution_quality <> 'unresolved'
                AND CASE leaf_corrections.kind
                  WHEN 'retract' THEN NULL
                  WHEN 'replace' THEN leaf_corrections.replacement_value
                  WHEN 'adjust' THEN candidate_readings.exact_value + leaf_corrections.exact_delta
                  ELSE candidate_readings.exact_value
                END IS NOT NULL AS eligible
            FROM candidate_readings
            LEFT JOIN correction_history
              ON correction_history.reading_id = candidate_readings.id
            LEFT JOIN leaf_corrections
              ON leaf_corrections.reading_id = candidate_readings.id
          ), readings AS MATERIALIZED (
            SELECT effective_readings.property_id,
              count(*) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.propertyReviewDashboard}
                  AND event_at >= period_start AND event_at < period_end
                  AND eligible
              ) AS review_count,
              count(*) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.propertyReviewDashboard}
                  AND event_at >= period_start AND event_at < period_end
              ) AS review_total_count,
              count(*) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.propertyReviewDashboard}
                  AND ${comparisonAvailable}
                  AND event_at >= prior_start AND event_at < prior_end
                  AND eligible
              ) AS prior_review_count,
              avg(effective_value) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.propertyReviewDashboard}
                  AND event_at >= period_start AND event_at < period_end
                  AND eligible
              ) AS avg_rating,
              avg(effective_value) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.propertyReviewDashboard}
                  AND ${comparisonAvailable}
                  AND event_at >= prior_start AND event_at < prior_end
                  AND eligible
              ) AS prior_avg_rating,
              max(recorded_at) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.propertyReviewDashboard}
                  AND event_at >= period_start AND event_at < period_end
                  AND eligible
              ) AS review_watermark,
              coalesce(sum(correction_count) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.propertyReviewDashboard}
                  AND event_at >= period_start AND event_at < period_end
              ), 0) AS review_correction_count,
              coalesce(array_agg(DISTINCT source_policy) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.propertyReviewDashboard}
                  AND event_at >= period_start AND event_at < period_end
                  AND eligible
                  AND source_policy IS NOT NULL
              ), '{}'::varchar[]) AS review_source_policies,
              coalesce(sum(effective_value) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.portalScanAnalytics}
                  AND event_at >= period_start AND event_at < period_end
                  AND eligible
              ), 0) AS scan_count,
              count(*) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.portalScanAnalytics}
                  AND event_at >= period_start AND event_at < period_end
                  AND eligible
              ) AS scan_eligible_count,
              count(*) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.portalScanAnalytics}
                  AND event_at >= period_start AND event_at < period_end
              ) AS scan_total_count,
              max(recorded_at) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.portalScanAnalytics}
                  AND event_at >= period_start AND event_at < period_end
                  AND eligible
              ) AS scan_watermark,
              coalesce(sum(correction_count) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.portalScanAnalytics}
                  AND event_at >= period_start AND event_at < period_end
              ), 0) AS scan_correction_count,
              coalesce(array_agg(DISTINCT source_policy) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.portalScanAnalytics}
                  AND event_at >= period_start AND event_at < period_end
                  AND eligible
                  AND source_policy IS NOT NULL
              ), '{}'::varchar[]) AS scan_source_policies,
              coalesce(sum(effective_value) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.portalFeedbackAnalytics}
                  AND event_at >= period_start AND event_at < period_end
                  AND eligible
              ), 0) AS feedback_count,
              count(*) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.portalFeedbackAnalytics}
                  AND event_at >= period_start AND event_at < period_end
                  AND eligible
              ) AS feedback_eligible_count,
              count(*) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.portalFeedbackAnalytics}
                  AND event_at >= period_start AND event_at < period_end
              ) AS feedback_total_count,
              max(recorded_at) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.portalFeedbackAnalytics}
                  AND event_at >= period_start AND event_at < period_end
                  AND eligible
              ) AS feedback_watermark,
              coalesce(sum(correction_count) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.portalFeedbackAnalytics}
                  AND event_at >= period_start AND event_at < period_end
              ), 0) AS feedback_correction_count,
              coalesce(array_agg(DISTINCT source_policy) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.portalFeedbackAnalytics}
                  AND event_at >= period_start AND event_at < period_end
                  AND eligible
                  AND source_policy IS NOT NULL
              ), '{}'::varchar[]) AS feedback_source_policies
            FROM effective_readings
            GROUP BY effective_readings.property_id
          ), summary AS MATERIALIZED (
            -- A Property without readings adds nothing to these sums.
            SELECT (SELECT count(*) FROM scoped) AS property_count,
              coalesce(sum(review_count), 0) AS rating_sample_count,
              coalesce(
                sum(avg_rating * review_count) / nullif(sum(review_count), 0),
                0
              ) AS overall_avg_rating,
              count(*) FILTER (
                WHERE review_count >= ${MIN_RATING_COMPARISON_SAMPLE}
                  AND prior_review_count >= ${MIN_RATING_COMPARISON_SAMPLE}
                  AND prior_avg_rating - avg_rating >= ${RATING_DROP_THRESHOLD}
              ) AS rating_drop_total
            FROM readings
          ), page_scope AS MATERIALIZED (
            SELECT scoped.*
            FROM scoped
            WHERE (
                ${cursorName}::text IS NULL
                OR (lower(scoped.name), scoped.property_id) >
                  (${cursorName}::text, ${cursorId}::uuid)
              )
            ORDER BY lower(scoped.name), scoped.property_id
            LIMIT ${FLEET_PAGE_SIZE + 1}
          ), ordered AS MATERIALIZED (
            SELECT page_scope.*,
              ${portalEnabled} AS portal_enabled,
              coalesce(readings.review_count, 0) AS review_count,
              coalesce(readings.review_total_count, 0) AS review_total_count,
              coalesce(readings.prior_review_count, 0) AS prior_review_count,
              readings.avg_rating AS avg_rating,
              readings.prior_avg_rating AS prior_avg_rating,
              readings.review_watermark,
              coalesce(readings.review_correction_count, 0) AS review_correction_count,
              coalesce(readings.review_source_policies, '{}'::varchar[]) AS review_source_policies,
              CASE WHEN ${portalEnabled} THEN coalesce(readings.scan_count, 0) ELSE 0 END AS scan_count,
              CASE WHEN ${portalEnabled} THEN coalesce(readings.scan_eligible_count, 0) ELSE 0 END AS scan_eligible_count,
              CASE WHEN ${portalEnabled} THEN coalesce(readings.scan_total_count, 0) ELSE 0 END AS scan_total_count,
              CASE WHEN ${portalEnabled} THEN readings.scan_watermark ELSE NULL END AS scan_watermark,
              CASE WHEN ${portalEnabled} THEN coalesce(readings.scan_correction_count, 0) ELSE 0 END AS scan_correction_count,
              CASE WHEN ${portalEnabled} THEN coalesce(readings.scan_source_policies, '{}'::varchar[]) ELSE '{}'::varchar[] END AS scan_source_policies,
              CASE WHEN ${portalEnabled} THEN coalesce(readings.feedback_count, 0) ELSE 0 END AS feedback_count,
              CASE WHEN ${portalEnabled} THEN coalesce(readings.feedback_eligible_count, 0) ELSE 0 END AS feedback_eligible_count,
              CASE WHEN ${portalEnabled} THEN coalesce(readings.feedback_total_count, 0) ELSE 0 END AS feedback_total_count,
              CASE WHEN ${portalEnabled} THEN readings.feedback_watermark ELSE NULL END AS feedback_watermark,
              CASE WHEN ${portalEnabled} THEN coalesce(readings.feedback_correction_count, 0) ELSE 0 END AS feedback_correction_count,
              CASE WHEN ${portalEnabled} THEN coalesce(readings.feedback_source_policies, '{}'::varchar[]) ELSE '{}'::varchar[] END AS feedback_source_policies
            FROM page_scope
            LEFT JOIN readings USING (property_id)
            ORDER BY lower(page_scope.name), page_scope.property_id
          ), page AS MATERIALIZED (
            SELECT * FROM ordered
            ORDER BY lower(name), property_id
            LIMIT ${FLEET_PAGE_SIZE}
          ), inbox_attention_items AS MATERIALIZED (
            SELECT inbox_items.property_id::uuid AS property_id,
              inbox_items.source_type,
              inbox_items.source_id,
              inbox_items.status,
              inbox_items.is_escalated,
              inbox_items.escalation_resolved_at
            FROM inbox_items
            WHERE inbox_items.organization_id = ${input.organizationId}
              AND inbox_items.property_id IN (
                SELECT property_id::text FROM scoped
              )
              AND (
                inbox_items.status = 'open'
                OR (
                  inbox_items.is_escalated = true
                  AND inbox_items.escalation_resolved_at IS NULL
                )
              )
          ), inbox_attention AS MATERIALIZED (
            SELECT inbox_attention_items.property_id,
              count(*) FILTER (
                WHERE inbox_attention_items.status = 'open'
              ) AS items_to_triage,
              count(*) FILTER (
                WHERE inbox_attention_items.is_escalated = true
                  AND inbox_attention_items.escalation_resolved_at IS NULL
              ) AS escalated
            FROM inbox_attention_items
            GROUP BY inbox_attention_items.property_id
          ), attention_work AS MATERIALIZED (
            SELECT property_id, count(*) AS needs_attention
            FROM (
              SELECT property_id, source_type::text || ':' || source_id::text
                AS work_key
              FROM inbox_attention_items
            ) work
            GROUP BY property_id
          ), totals AS MATERIALIZED (
            SELECT coalesce(
              (SELECT sum(needs_attention) FROM attention_work),
              0
            ) AS total_attention_work
          )
          SELECT page.property_id::text AS property_id,
            page.name,
            lower(page.name) AS cursor_lower_name,
            page.slug,
            page.timezone,
            page.period_start,
            page.period_end,
            page.review_count,
            page.prior_review_count,
            page.avg_rating,
            page.prior_avg_rating,
            page.scan_count,
            page.feedback_count,
            page.portal_enabled,
            page.review_total_count,
            page.review_watermark,
            page.review_correction_count,
            page.review_source_policies,
            page.scan_eligible_count,
            page.scan_total_count,
            page.scan_watermark,
            page.scan_correction_count,
            page.scan_source_policies,
            page.feedback_eligible_count,
            page.feedback_total_count,
            page.feedback_watermark,
            page.feedback_correction_count,
            page.feedback_source_policies,
            coalesce(inbox_attention.items_to_triage, 0) AS items_to_triage,
            coalesce(inbox_attention.escalated, 0) AS escalated,
            coalesce(attention_work.needs_attention, 0) AS needs_attention,
            (page.lifecycle_state = 'active') AS lifecycle_active,
            (page.google_binding_state = 'active') AS google_binding_active,
            google.review_count AS google_review_count,
            google.average_rating AS google_average_rating,
            google.evaluated_at AS google_verified_at,
            rating_goal.mode AS rating_goal_mode,
            rating_goal.target_tenths AS rating_goal_target_tenths,
            rating_goal.last_evaluated_status AS rating_goal_status,
            totals.total_attention_work,
            summary.property_count,
            summary.rating_sample_count,
            summary.overall_avg_rating,
            summary.rating_drop_total,
            (SELECT count(*) > ${FLEET_PAGE_SIZE} FROM ordered) AS has_more
          FROM summary
          CROSS JOIN totals
          LEFT JOIN page ON true
          LEFT JOIN inbox_attention USING (property_id)
          LEFT JOIN attention_work USING (property_id)
          -- Google's own number and count (decision 16), the snapshot at the
          -- Property's current binding epoch, and the active rating goal as
          -- stored: one row each by primary key or the one-active index, for
          -- the page only, so no read per Property and no live evaluation.
          LEFT JOIN metric_current_google_reputation_snapshots google
            ON google.organization_id = ${input.organizationId}
            AND google.property_id = page.property_id
            AND google.source_epoch = page.source_epoch
          LEFT JOIN property_rating_goals rating_goal
            ON ${goalEnabled}
            AND rating_goal.organization_id = ${input.organizationId}
            AND rating_goal.property_id = page.property_id
            AND rating_goal.status = 'active'
          ORDER BY lower(page.name), page.property_id
        `)
        // Goals behind pace are counted for every Property in scope, not only
        // the page, because the total below sums them all. A capability the
        // reader lacks reads no goal.
        const goalMonths = input.goalReadEnabled
          ? await readRunningCountMonths(tx, {
              organizationId: input.organizationId,
              properties: sql`results.property_id IN (
                SELECT properties.id FROM properties
                WHERE properties.organization_id = ${input.organizationId}
                  AND properties.deleted_at IS NULL
                  AND properties.lifecycle_state IN ('active', 'suspended')
                  AND ${accessFilter}
              )`,
              now: input.now,
            })
          : []
        return { mainResult, goalMonths }
      },
    )
    const goalsBehindPace = goalsBehindPaceByProperty(goalMonths, input.now)
    const allGoalsBehindPace = [...goalsBehindPace.values()].reduce(
      (total, count) => total + count,
      0,
    )

    const main = mainResult.rows as unknown as readonly MainRow[]
    const head = main[0]
    const page = main.filter(
      (
        row,
      ): row is MainRow & {
        property_id: string
        name: string
        slug: string
        timezone: string
      } =>
        row.property_id !== null &&
        row.name !== null &&
        row.slug !== null &&
        row.timezone !== null,
    )

    const rows: FleetOverviewProjectionRow[] = page.map((row) => {
      const portalEnabled = row.portal_enabled === true
      const periodStart = requiredDateValue(row.period_start)
      const periodEnd = requiredDateValue(row.period_end)
      return {
        propertyId: propertyId(row.property_id),
        name: row.name,
        slug: row.slug,
        timezone: row.timezone,
        reviewCount: numeric(row.review_count),
        priorReviewCount: numeric(row.prior_review_count),
        avgRating: row.avg_rating === null ? null : Number(row.avg_rating),
        priorAvgRating:
          row.prior_avg_rating === null ? null : Number(row.prior_avg_rating),
        scanCount: numeric(row.scan_count),
        feedbackCount: numeric(row.feedback_count),
        // Inbox replaces this neutral value in the Fleet use-case boundary.
        overdue: 0,
        itemsToTriage: numeric(row.items_to_triage),
        escalated: numeric(row.escalated),
        goalsBehindPace: goalsBehindPace.get(row.property_id) ?? 0,
        needsAttention:
          numeric(row.needs_attention) + (goalsBehindPace.get(row.property_id) ?? 0),
        reviewEvidence: evidence({
          definitionVersionId: METRIC_VERSION_IDS.propertyReviewDashboard,
          periodStart,
          periodEnd,
          timezone: row.timezone,
          sourcePolicies: row.review_source_policies,
          watermark: row.review_watermark,
          eligibleCount: numeric(row.review_count),
          totalCount: numeric(row.review_total_count),
          correctionCount: numeric(row.review_correction_count),
          now: input.now,
        }),
        scanEvidence: portalEnabled
          ? evidence({
              definitionVersionId: METRIC_VERSION_IDS.portalScanAnalytics,
              periodStart,
              periodEnd,
              timezone: row.timezone,
              sourcePolicies: row.scan_source_policies,
              watermark: row.scan_watermark,
              eligibleCount: numeric(row.scan_eligible_count),
              totalCount: numeric(row.scan_total_count),
              correctionCount: numeric(row.scan_correction_count),
              now: input.now,
            })
          : null,
        feedbackEvidence: portalEnabled
          ? evidence({
              definitionVersionId: METRIC_VERSION_IDS.portalFeedbackAnalytics,
              periodStart,
              periodEnd,
              timezone: row.timezone,
              sourcePolicies: row.feedback_source_policies,
              watermark: row.feedback_watermark,
              eligibleCount: numeric(row.feedback_eligible_count),
              totalCount: numeric(row.feedback_total_count),
              correctionCount: numeric(row.feedback_correction_count),
              now: input.now,
            })
          : null,
        google: googleOf(row),
        lifecycleActive: row.lifecycle_active === true,
        ratingGoal: ratingGoalOf(row),
      }
    })

    const propertyCount = numeric(head?.property_count)
    const totalAttention =
      numeric(head?.total_attention_work) +
      allGoalsBehindPace +
      numeric(head?.rating_drop_total)
    const last = page.at(-1)
    const nextAnchor =
      head?.has_more === true && last
        ? {
            lowerName: last.cursor_lower_name ?? last.name.toLowerCase(),
            propertyId: propertyId(last.property_id),
          }
        : null
    instrumentation?.onRead({
      propertyCount,
      returnedRows: rows.length,
      durationMs: Math.max(0, performance.now() - readStartedAt),
    })

    return {
      rows,
      summary: {
        propertyCount,
        ratingSampleCount: numeric(head?.rating_sample_count),
        overallAvgRating: numeric(head?.overall_avg_rating),
        totalAttention,
      },
      nextAnchor,
    }
  },
})
