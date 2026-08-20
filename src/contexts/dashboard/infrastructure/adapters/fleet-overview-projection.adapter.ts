import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { propertyId } from '#/shared/domain/ids'
import { METRIC_VERSION_IDS } from '#/contexts/metric/application/public-api'
import type { FleetMetricEvidence, FleetMetricFreshness } from '../../domain/types'
import type {
  FleetOverviewProjectionPort,
  FleetOverviewProjectionRow,
} from '../../application/ports/fleet-overview-projection.port'
import { FLEET_PAGE_SIZE } from '../../application/ports/fleet-overview-projection.port'
import { DASHBOARD_READ_BUDGET_MS, withStatementTimeout } from '../read-facade'

export const FLEET_OVERVIEW_STATEMENT_BOUND = 4
const FRESHNESS_WINDOW_MS = 48 * 60 * 60 * 1_000

export type FleetOverviewProjectionInstrumentation = Readonly<{
  onRead(
    value: Readonly<{
      propertyCount: number
      returnedRows: number
      statementCount: number
      statementBound: number
      withinBound: boolean
    }>,
  ): void
}>

type MainRow = Readonly<{
  property_id: string | null
  name: string | null
  cursor_lower_name: string | null
  slug: string | null
  timezone: string | null
  review_count: string | number | null
  prior_review_count: string | number | null
  avg_rating: string | number | null
  prior_avg_rating: string | number | null
  scan_count: string | number | null
  feedback_count: string | number | null
  property_count: string | number
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
  unanswered: string | number | null
  new_feedback: string | number | null
  escalated: string | number | null
  goals_behind_pace: string | number | null
  total_unanswered: string | number
  total_new_feedback: string | number
  total_escalated: string | number
  total_goals_behind_pace: string | number
}>

const numeric = (value: string | number | null | undefined): number =>
  Number(value ?? 0) || 0

function dateValue(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
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
    const cursorName = input.cursor?.lowerName ?? null
    const cursorId = input.cursor?.propertyId ?? null
    const accessFilter =
      input.accessiblePropertyIds === null
        ? sql`TRUE`
        : input.accessiblePropertyIds.length === 0
          ? sql`FALSE`
          : sql`properties.id IN (${sql.join(
              input.accessiblePropertyIds.map((id) => sql`${id}::uuid`),
              sql`, `,
            )})`

    const mainResult = await withStatementTimeout(
      db,
      DASHBOARD_READ_BUDGET_MS,
      async (tx) => {
        const mainResult = await tx.execute(sql`
          WITH scoped AS MATERIALIZED (
            SELECT properties.id AS property_id,
              properties.name,
              properties.slug,
              properties.timezone
            FROM properties
            WHERE properties.organization_id = ${input.organizationId}
              AND properties.deleted_at IS NULL
              AND ${accessFilter}
          ), policy AS MATERIALIZED (
            SELECT scoped.property_id,
              ${input.portalReadEnabled}
                AND EXISTS (
                  SELECT 1 FROM property_capability
                  WHERE property_capability.property_id = scoped.property_id
                    AND property_capability.capability = 'portal.read'
                )
                AND NOT EXISTS (
                  SELECT 1 FROM property_policy
                  WHERE property_policy.property_id = scoped.property_id
                    AND property_policy.suspended_at IS NOT NULL
                ) AS portal_enabled,
              ${input.goalReadEnabled}
                AND EXISTS (
                  SELECT 1 FROM property_capability
                  WHERE property_capability.property_id = scoped.property_id
                    AND property_capability.capability = 'goal.use'
                )
                AND NOT EXISTS (
                  SELECT 1 FROM property_policy
                  WHERE property_policy.property_id = scoped.property_id
                    AND property_policy.suspended_at IS NOT NULL
                ) AS goal_enabled
            FROM scoped
          ), candidate_readings AS MATERIALIZED (
            SELECT metric_readings.*
            FROM metric_readings
            JOIN metric_definition_versions
              ON metric_definition_versions.id = metric_readings.definition_version_id
              AND (
                (
                  metric_readings.definition_version_id = ${METRIC_VERSION_IDS.propertyReviewDashboard}
                  AND metric_definition_versions.permitted_consumers @> '["dashboard"]'::jsonb
                )
                OR (
                  metric_readings.definition_version_id IN (
                    ${METRIC_VERSION_IDS.portalScanAnalytics},
                    ${METRIC_VERSION_IDS.portalFeedbackAnalytics}
                  )
                  AND metric_definition_versions.permitted_consumers @> '["portal_analytics"]'::jsonb
                )
              )
            WHERE metric_readings.organization_id = ${input.organizationId}
              AND metric_readings.property_id IN (SELECT property_id FROM scoped)
              AND metric_readings.definition_version_id IN (
                ${METRIC_VERSION_IDS.propertyReviewDashboard},
                ${METRIC_VERSION_IDS.portalScanAnalytics},
                ${METRIC_VERSION_IDS.portalFeedbackAnalytics}
              )
              AND metric_readings.event_at BETWEEN ${input.priorStartDate} AND ${input.endDate}
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
                  AND event_at BETWEEN ${input.startDate} AND ${input.endDate}
                  AND eligible
              ) AS review_count,
              count(*) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.propertyReviewDashboard}
                  AND event_at BETWEEN ${input.startDate} AND ${input.endDate}
              ) AS review_total_count,
              count(*) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.propertyReviewDashboard}
                  AND event_at BETWEEN ${input.priorStartDate} AND ${input.priorEndDate}
                  AND eligible
              ) AS prior_review_count,
              avg(effective_value) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.propertyReviewDashboard}
                  AND event_at BETWEEN ${input.startDate} AND ${input.endDate}
                  AND eligible
              ) AS avg_rating,
              avg(effective_value) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.propertyReviewDashboard}
                  AND event_at BETWEEN ${input.priorStartDate} AND ${input.priorEndDate}
                  AND eligible
              ) AS prior_avg_rating,
              max(recorded_at) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.propertyReviewDashboard}
                  AND event_at BETWEEN ${input.startDate} AND ${input.endDate}
                  AND eligible
              ) AS review_watermark,
              coalesce(sum(correction_count) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.propertyReviewDashboard}
                  AND event_at BETWEEN ${input.startDate} AND ${input.endDate}
              ), 0) AS review_correction_count,
              coalesce(array_agg(DISTINCT source_policy) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.propertyReviewDashboard}
                  AND event_at BETWEEN ${input.startDate} AND ${input.endDate}
                  AND eligible
                  AND source_policy IS NOT NULL
              ), '{}'::varchar[]) AS review_source_policies,
              coalesce(sum(effective_value) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.portalScanAnalytics}
                  AND event_at BETWEEN ${input.startDate} AND ${input.endDate}
                  AND eligible
              ), 0) AS scan_count,
              count(*) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.portalScanAnalytics}
                  AND event_at BETWEEN ${input.startDate} AND ${input.endDate}
                  AND eligible
              ) AS scan_eligible_count,
              count(*) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.portalScanAnalytics}
                  AND event_at BETWEEN ${input.startDate} AND ${input.endDate}
              ) AS scan_total_count,
              max(recorded_at) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.portalScanAnalytics}
                  AND event_at BETWEEN ${input.startDate} AND ${input.endDate}
                  AND eligible
              ) AS scan_watermark,
              coalesce(sum(correction_count) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.portalScanAnalytics}
                  AND event_at BETWEEN ${input.startDate} AND ${input.endDate}
              ), 0) AS scan_correction_count,
              coalesce(array_agg(DISTINCT source_policy) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.portalScanAnalytics}
                  AND event_at BETWEEN ${input.startDate} AND ${input.endDate}
                  AND eligible
                  AND source_policy IS NOT NULL
              ), '{}'::varchar[]) AS scan_source_policies,
              coalesce(sum(effective_value) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.portalFeedbackAnalytics}
                  AND event_at BETWEEN ${input.startDate} AND ${input.endDate}
                  AND eligible
              ), 0) AS feedback_count,
              count(*) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.portalFeedbackAnalytics}
                  AND event_at BETWEEN ${input.startDate} AND ${input.endDate}
                  AND eligible
              ) AS feedback_eligible_count,
              count(*) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.portalFeedbackAnalytics}
                  AND event_at BETWEEN ${input.startDate} AND ${input.endDate}
              ) AS feedback_total_count,
              max(recorded_at) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.portalFeedbackAnalytics}
                  AND event_at BETWEEN ${input.startDate} AND ${input.endDate}
                  AND eligible
              ) AS feedback_watermark,
              coalesce(sum(correction_count) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.portalFeedbackAnalytics}
                  AND event_at BETWEEN ${input.startDate} AND ${input.endDate}
              ), 0) AS feedback_correction_count,
              coalesce(array_agg(DISTINCT source_policy) FILTER (
                WHERE definition_version_id = ${METRIC_VERSION_IDS.portalFeedbackAnalytics}
                  AND event_at BETWEEN ${input.startDate} AND ${input.endDate}
                  AND eligible
                  AND source_policy IS NOT NULL
              ), '{}'::varchar[]) AS feedback_source_policies
            FROM effective_readings
            GROUP BY effective_readings.property_id
          ), enriched AS MATERIALIZED (
            SELECT scoped.*,
              policy.portal_enabled,
              coalesce(readings.review_count, 0) AS review_count,
              coalesce(readings.review_total_count, 0) AS review_total_count,
              coalesce(readings.prior_review_count, 0) AS prior_review_count,
              coalesce(readings.avg_rating, 0) AS avg_rating,
              coalesce(readings.prior_avg_rating, 0) AS prior_avg_rating,
              readings.review_watermark,
              coalesce(readings.review_correction_count, 0) AS review_correction_count,
              coalesce(readings.review_source_policies, '{}'::varchar[]) AS review_source_policies,
              CASE WHEN policy.portal_enabled THEN coalesce(readings.scan_count, 0) ELSE 0 END AS scan_count,
              CASE WHEN policy.portal_enabled THEN coalesce(readings.scan_eligible_count, 0) ELSE 0 END AS scan_eligible_count,
              CASE WHEN policy.portal_enabled THEN coalesce(readings.scan_total_count, 0) ELSE 0 END AS scan_total_count,
              CASE WHEN policy.portal_enabled THEN readings.scan_watermark ELSE NULL END AS scan_watermark,
              CASE WHEN policy.portal_enabled THEN coalesce(readings.scan_correction_count, 0) ELSE 0 END AS scan_correction_count,
              CASE WHEN policy.portal_enabled THEN coalesce(readings.scan_source_policies, '{}'::varchar[]) ELSE '{}'::varchar[] END AS scan_source_policies,
              CASE WHEN policy.portal_enabled THEN coalesce(readings.feedback_count, 0) ELSE 0 END AS feedback_count,
              CASE WHEN policy.portal_enabled THEN coalesce(readings.feedback_eligible_count, 0) ELSE 0 END AS feedback_eligible_count,
              CASE WHEN policy.portal_enabled THEN coalesce(readings.feedback_total_count, 0) ELSE 0 END AS feedback_total_count,
              CASE WHEN policy.portal_enabled THEN readings.feedback_watermark ELSE NULL END AS feedback_watermark,
              CASE WHEN policy.portal_enabled THEN coalesce(readings.feedback_correction_count, 0) ELSE 0 END AS feedback_correction_count,
              CASE WHEN policy.portal_enabled THEN coalesce(readings.feedback_source_policies, '{}'::varchar[]) ELSE '{}'::varchar[] END AS feedback_source_policies
            FROM scoped
            JOIN policy USING (property_id)
            LEFT JOIN readings USING (property_id)
          ), summary AS MATERIALIZED (
            SELECT count(*) AS property_count,
              coalesce(avg(avg_rating) FILTER (WHERE avg_rating > 0), 0) AS overall_avg_rating,
              count(*) FILTER (
                WHERE prior_avg_rating > 0
                  AND prior_avg_rating - avg_rating >= 0.3
              ) AS rating_drop_total
            FROM enriched
          ), page_scope AS MATERIALIZED (
            SELECT properties.id AS property_id
            FROM properties
            WHERE properties.organization_id = ${input.organizationId}
              AND properties.deleted_at IS NULL
              AND ${accessFilter}
              AND (
                ${cursorName}::text IS NULL
                OR (lower(properties.name), properties.id) >
                  (${cursorName}::text, ${cursorId}::uuid)
              )
            ORDER BY lower(properties.name), properties.id
            LIMIT ${FLEET_PAGE_SIZE + 1}
          ), ordered AS MATERIALIZED (
            SELECT enriched.*
            FROM page_scope
            JOIN enriched USING (property_id)
            ORDER BY lower(enriched.name), enriched.property_id
          ), page AS MATERIALIZED (
            SELECT * FROM ordered
            ORDER BY lower(name), property_id
            LIMIT ${FLEET_PAGE_SIZE}
          ), review_attention AS MATERIALIZED (
            SELECT reviews.property_id, count(*) AS unanswered
            FROM reviews
            WHERE reviews.organization_id = ${input.organizationId}
              AND reviews.property_id IN (SELECT property_id FROM scoped)
              AND reviews.content_expires_at IS NOT NULL
              AND reviews.content_expires_at > ${input.now}
              AND reviews.reviewed_at < ${input.slaCutoff}
              AND NOT EXISTS (
                SELECT 1 FROM replies
                WHERE replies.review_id = reviews.id
                  AND replies.organization_id = ${input.organizationId}
                  AND replies.status = 'published'
              )
            GROUP BY reviews.property_id
          ), inbox_attention AS MATERIALIZED (
            SELECT inbox_items.property_id::uuid AS property_id,
              count(*) FILTER (WHERE inbox_items.status = 'open') AS new_feedback,
              count(*) FILTER (
                WHERE inbox_items.is_escalated = true
                  AND inbox_items.escalation_resolved_at IS NULL
              ) AS escalated
            FROM inbox_items
            WHERE inbox_items.organization_id = ${input.organizationId}
              AND inbox_items.property_id IN (
                SELECT property_id::text FROM scoped
              )
            GROUP BY inbox_items.property_id
          ), current_goal_evaluations AS MATERIALIZED (
            SELECT DISTINCT ON (goal_evaluations.period_id)
              goal_evaluations.period_id,
              goal_evaluations.value,
              goal_evaluations.state
            FROM goal_evaluations
            WHERE ${input.goalReadEnabled}
              AND goal_evaluations.organization_id = ${input.organizationId}
              AND goal_evaluations.property_id IN (SELECT property_id FROM scoped)
              AND NOT EXISTS (
                SELECT 1 FROM goal_evaluations successor
                WHERE successor.supersedes_evaluation_id = goal_evaluations.id
              )
            ORDER BY goal_evaluations.period_id,
              goal_evaluations.created_at DESC,
              goal_evaluations.id DESC
          ), goal_attention AS MATERIALIZED (
            SELECT goal_periods.property_id, count(*) AS goals_behind_pace
            FROM goal_periods
            JOIN goal_definitions
              ON goal_definitions.organization_id = goal_periods.organization_id
              AND goal_definitions.property_id = goal_periods.property_id
              AND goal_definitions.id = goal_periods.definition_id
            JOIN goal_definition_versions
              ON goal_definition_versions.organization_id = goal_periods.organization_id
              AND goal_definition_versions.property_id = goal_periods.property_id
              AND goal_definition_versions.definition_id = goal_periods.definition_id
              AND goal_definition_versions.id = goal_periods.definition_version_id
            JOIN current_goal_evaluations
              ON current_goal_evaluations.period_id = goal_periods.id
            JOIN policy
              ON policy.property_id = goal_periods.property_id
              AND policy.goal_enabled
            WHERE goal_periods.organization_id = ${input.organizationId}
              AND goal_periods.status = 'open'
              AND goal_definitions.status = 'active'
              AND goal_periods.period_start <= ${input.now}
              AND goal_periods.period_end > ${input.now}
              AND current_goal_evaluations.state = 'eligible'
              AND current_goal_evaluations.value <
                goal_definition_versions.target_value
                * greatest(
                  0,
                  least(
                    1,
                    extract(epoch FROM (${input.now} - goal_periods.period_start))
                      / nullif(
                          extract(epoch FROM (goal_periods.period_end - goal_periods.period_start)),
                          0
                        )
                  )
                )
            GROUP BY goal_periods.property_id
          ), totals AS MATERIALIZED (
            SELECT
              coalesce((SELECT sum(unanswered) FROM review_attention), 0) AS total_unanswered,
              coalesce((SELECT sum(new_feedback) FROM inbox_attention), 0) AS total_new_feedback,
              coalesce((SELECT sum(escalated) FROM inbox_attention), 0) AS total_escalated,
              coalesce((SELECT sum(goals_behind_pace) FROM goal_attention), 0) AS total_goals_behind_pace
          )
          SELECT page.property_id::text AS property_id,
            page.name,
            lower(page.name) AS cursor_lower_name,
            page.slug,
            page.timezone,
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
            coalesce(review_attention.unanswered, 0) AS unanswered,
            coalesce(inbox_attention.new_feedback, 0) AS new_feedback,
            coalesce(inbox_attention.escalated, 0) AS escalated,
            coalesce(goal_attention.goals_behind_pace, 0) AS goals_behind_pace,
            totals.total_unanswered,
            totals.total_new_feedback,
            totals.total_escalated,
            totals.total_goals_behind_pace,
            summary.property_count,
            summary.overall_avg_rating,
            summary.rating_drop_total,
            (SELECT count(*) > ${FLEET_PAGE_SIZE} FROM ordered) AS has_more
          FROM summary
          CROSS JOIN totals
          LEFT JOIN page ON true
          LEFT JOIN review_attention USING (property_id)
          LEFT JOIN inbox_attention USING (property_id)
          LEFT JOIN goal_attention USING (property_id)
          ORDER BY lower(page.name), page.property_id
        `)
        return mainResult
      },
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
      return {
        propertyId: propertyId(row.property_id),
        name: row.name,
        slug: row.slug,
        timezone: row.timezone,
        reviewCount: numeric(row.review_count),
        priorReviewCount: numeric(row.prior_review_count),
        avgRating: numeric(row.avg_rating),
        priorAvgRating: numeric(row.prior_avg_rating),
        scanCount: numeric(row.scan_count),
        feedbackCount: numeric(row.feedback_count),
        unanswered: numeric(row.unanswered),
        newFeedback: numeric(row.new_feedback),
        escalated: numeric(row.escalated),
        goalsBehindPace: numeric(row.goals_behind_pace),
        reviewEvidence: evidence({
          definitionVersionId: METRIC_VERSION_IDS.propertyReviewDashboard,
          periodStart: input.startDate,
          periodEnd: input.endDate,
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
              periodStart: input.startDate,
              periodEnd: input.endDate,
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
              periodStart: input.startDate,
              periodEnd: input.endDate,
              sourcePolicies: row.feedback_source_policies,
              watermark: row.feedback_watermark,
              eligibleCount: numeric(row.feedback_eligible_count),
              totalCount: numeric(row.feedback_total_count),
              correctionCount: numeric(row.feedback_correction_count),
              now: input.now,
            })
          : null,
      }
    })

    const propertyCount = numeric(head?.property_count)
    const totalAttention =
      numeric(head?.rating_drop_total) +
      numeric(head?.total_unanswered) +
      numeric(head?.total_new_feedback) +
      numeric(head?.total_escalated) +
      numeric(head?.total_goals_behind_pace)
    const last = page.at(-1)
    const nextAnchor =
      head?.has_more === true && last
        ? {
            lowerName: last.cursor_lower_name ?? last.name.toLowerCase(),
            propertyId: propertyId(last.property_id),
          }
        : null
    const statementCount = 4

    instrumentation?.onRead({
      propertyCount,
      returnedRows: rows.length,
      statementCount,
      statementBound: FLEET_OVERVIEW_STATEMENT_BOUND,
      withinBound: statementCount <= FLEET_OVERVIEW_STATEMENT_BOUND,
    })

    return {
      rows,
      summary: {
        propertyCount,
        overallAvgRating: numeric(head?.overall_avg_rating),
        totalAttention,
      },
      nextAnchor,
    }
  },
})
