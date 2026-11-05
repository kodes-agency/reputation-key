import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { propertyId } from '#/shared/domain/ids'
import type {
  FleetOverviewProjectionPort,
  FleetOverviewProjectionRow,
} from '../../application/ports/fleet-overview-projection.port'
import { FLEET_PAGE_SIZE } from '../../application/ports/fleet-overview-projection.port'
import { goalsBehindPaceByProperty } from '../../domain/goal-pace'
import type { RatingGoalMode, RatingGoalStatus } from '../../domain/rating-goal'
import { DASHBOARD_READ_BUDGET_MS, withStatementTimeout } from '../read-facade'
import { readRunningCountMonths } from './goal-running-months'

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
  property_count: string | number
  has_more: boolean
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

export const createFleetOverviewProjectionAdapter = (
  db: Database,
  instrumentation?: FleetOverviewProjectionInstrumentation,
): FleetOverviewProjectionPort => ({
  async read(input) {
    const readStartedAt = performance.now()
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
    // Read capabilities are organization-wide, so they stay statement constants
    // rather than a per-Property CTE the statement would have to join.
    const goalEnabled = sql`${input.goalReadEnabled}::boolean`

    const { mainResult, goalMonths } = await withStatementTimeout(
      db,
      DASHBOARD_READ_BUDGET_MS,
      async (tx) => {
        const mainResult = await tx.execute(sql`
          WITH scoped AS MATERIALIZED (
            SELECT properties.id AS property_id,
              properties.name,
              properties.slug,
              properties.timezone,
              properties.source_epoch,
              properties.lifecycle_state,
              properties.google_binding_state
            FROM properties
            WHERE properties.organization_id = ${input.organizationId}
              AND properties.deleted_at IS NULL
              -- The workspace: a removed Property (archived and later) is listed
              -- apart, with no figures, so it takes no page slot and no total.
              AND properties.lifecycle_state IN ('active', 'suspended')
              AND ${accessFilter}
          ), summary AS MATERIALIZED (
            SELECT count(*) AS property_count FROM scoped
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
          ), page AS MATERIALIZED (
            SELECT * FROM page_scope
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
            (SELECT count(*) > ${FLEET_PAGE_SIZE} FROM page_scope) AS has_more
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
      return {
        propertyId: propertyId(row.property_id),
        name: row.name,
        slug: row.slug,
        timezone: row.timezone,
        itemsToTriage: numeric(row.items_to_triage),
        escalated: numeric(row.escalated),
        goalsBehindPace: goalsBehindPace.get(row.property_id) ?? 0,
        needsAttention:
          numeric(row.needs_attention) + (goalsBehindPace.get(row.property_id) ?? 0),
        google: googleOf(row),
        lifecycleActive: row.lifecycle_active === true,
        ratingGoal: ratingGoalOf(row),
      }
    })

    const propertyCount = numeric(head?.property_count)
    const totalAttention = numeric(head?.total_attention_work) + allGoalsBehindPace
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
        totalAttention,
      },
      nextAnchor,
    }
  },
})
