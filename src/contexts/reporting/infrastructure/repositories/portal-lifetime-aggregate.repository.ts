import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { trace } from '#/shared/observability/trace'
import type {
  PortalLifetimeAggregate,
  PortalLifetimeAggregatePort,
  PortalLifetimeReconciliation,
  PortalLifetimeScope,
} from '../../application/ports/portal-lifetime-aggregate.port'
import {
  applyPortalLifetimeContribution,
  assertPortalLifetimeValues,
  emptyPortalLifetimeValues,
  type PortalLifetimeValues,
} from '../../domain/portal-lifetime-aggregate'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'
import {
  lockPortalLifetimeAggregate,
  portalLifetimeStoredRow,
  readPortalLifetimeAggregateForUpdate,
  writePortalLifetimeAggregate,
  type PortalLifetimeStoredRow,
} from '../portal-lifetime-aggregate-store'

type AggregateQueryRow = Readonly<{
  qualifiedScanCount: unknown
  privateRatingCount: unknown
  privateRatingSum: unknown
  privateRating1Count: unknown
  privateRating2Count: unknown
  privateRating3Count: unknown
  privateRating4Count: unknown
  privateRating5Count: unknown
  privateFeedbackCount: unknown
  googleReviewSelectionCount: unknown
  secondaryLinkSelectionCount: unknown
  invalidFactCount: unknown
}>

const n = (value: unknown): number => Number(value ?? 0)

function valuesFromAggregateRow(
  row: AggregateQueryRow | undefined,
): PortalLifetimeValues {
  const values = row
    ? {
        qualifiedScanCount: n(row.qualifiedScanCount),
        privateRatingCount: n(row.privateRatingCount),
        privateRatingSum: n(row.privateRatingSum),
        privateRating1Count: n(row.privateRating1Count),
        privateRating2Count: n(row.privateRating2Count),
        privateRating3Count: n(row.privateRating3Count),
        privateRating4Count: n(row.privateRating4Count),
        privateRating5Count: n(row.privateRating5Count),
        privateFeedbackCount: n(row.privateFeedbackCount),
        googleReviewSelectionCount: n(row.googleReviewSelectionCount),
        secondaryLinkSelectionCount: n(row.secondaryLinkSelectionCount),
      }
    : emptyPortalLifetimeValues()
  assertPortalLifetimeValues(values, 'Portal lifetime rebuild produced invalid totals')
  return values
}

function toAggregate(
  scope: PortalLifetimeScope,
  row: PortalLifetimeStoredRow,
): PortalLifetimeAggregate {
  return {
    ...scope,
    definitionVersionIds: {
      qualifiedScans: METRIC_VERSION_IDS.qualifiedScanGoal,
      privateRatings: METRIC_VERSION_IDS.portalRatingAnalytics,
      privateFeedback: METRIC_VERSION_IDS.portalFeedbackAnalytics,
      destinationSelections: METRIC_VERSION_IDS.portalDestinationClickAnalytics,
    },
    values: row.values,
    sealedThroughLocalDate: row.sealedThroughLocalDate,
    projectionRevision: row.projectionRevision,
    lastRebuiltAt: row.lastRebuiltAt ?? null,
    lastSealedAt: row.lastSealedAt ?? null,
  }
}

const valuesEqual = (left: PortalLifetimeValues, right: PortalLifetimeValues) =>
  JSON.stringify(left) === JSON.stringify(right)

async function readEffectiveValues(
  tx: Pick<Database, 'execute'>,
  scope: PortalLifetimeScope,
  bounds: Readonly<{ fromLocalDate: string | null; toLocalDate: string | null }>,
): Promise<PortalLifetimeValues> {
  const lowerBound = bounds.fromLocalDate
    ? sql`AND reading.property_local_date >= ${bounds.fromLocalDate}`
    : sql``
  const upperBound = bounds.toLocalDate
    ? sql`AND reading.property_local_date < ${bounds.toLocalDate}`
    : sql``
  const result = await tx.execute(sql`
    WITH correction_tips AS (
      SELECT correction.reading_id, correction.kind,
             correction.exact_delta, correction.replacement_value
      FROM metric_corrections AS correction
      WHERE NOT EXISTS (
        SELECT 1
        FROM metric_corrections AS successor
        WHERE successor.supersedes_correction_id = correction.id
      )
    ), effective AS (
      SELECT
        reading.metric_key,
        reading.definition_version_id,
        reading.portal_destination_kind,
        CASE
          WHEN tip.kind = 'retract' THEN NULL
          WHEN tip.kind = 'replace' THEN tip.replacement_value
          WHEN tip.kind = 'adjust' THEN reading.exact_value + tip.exact_delta
          ELSE reading.exact_value
        END AS effective_value
      FROM metric_readings AS reading
      LEFT JOIN correction_tips AS tip ON tip.reading_id = reading.id
      WHERE reading.organization_id = ${scope.organizationId}
        AND reading.property_id = ${scope.propertyId}
        AND reading.portal_id = ${scope.portalId}
        AND reading.property_local_date IS NOT NULL
        ${lowerBound}
        ${upperBound}
        AND reading.exact_value IS NOT NULL
        AND reading.data_quality = 'exact'
        AND reading.attribution_quality <> 'unresolved'
        AND (
          (reading.definition_version_id = ${METRIC_VERSION_IDS.qualifiedScanGoal}::uuid
            AND reading.metric_key = 'portal.qualified_scan')
          OR
          (reading.definition_version_id = ${METRIC_VERSION_IDS.portalRatingAnalytics}::uuid
            AND reading.metric_key = 'portal.rating')
          OR
          (reading.definition_version_id = ${METRIC_VERSION_IDS.portalFeedbackAnalytics}::uuid
            AND reading.metric_key = 'portal.feedback')
          OR
          (reading.definition_version_id = ${METRIC_VERSION_IDS.portalDestinationClickAnalytics}::uuid
            AND reading.metric_key = 'portal.review_link_click')
        )
    )
    SELECT
      count(*) FILTER (
        WHERE metric_key = 'portal.qualified_scan' AND effective_value = 1
      )::bigint AS "qualifiedScanCount",
      count(*) FILTER (
        WHERE metric_key = 'portal.rating'
          AND effective_value BETWEEN 1 AND 5
          AND effective_value = trunc(effective_value)
      )::bigint AS "privateRatingCount",
      coalesce(sum(effective_value) FILTER (
        WHERE metric_key = 'portal.rating'
          AND effective_value BETWEEN 1 AND 5
          AND effective_value = trunc(effective_value)
      ), 0)::bigint AS "privateRatingSum",
      count(*) FILTER (WHERE metric_key = 'portal.rating' AND effective_value = 1)::bigint
        AS "privateRating1Count",
      count(*) FILTER (WHERE metric_key = 'portal.rating' AND effective_value = 2)::bigint
        AS "privateRating2Count",
      count(*) FILTER (WHERE metric_key = 'portal.rating' AND effective_value = 3)::bigint
        AS "privateRating3Count",
      count(*) FILTER (WHERE metric_key = 'portal.rating' AND effective_value = 4)::bigint
        AS "privateRating4Count",
      count(*) FILTER (WHERE metric_key = 'portal.rating' AND effective_value = 5)::bigint
        AS "privateRating5Count",
      count(*) FILTER (
        WHERE metric_key = 'portal.feedback' AND effective_value = 1
      )::bigint AS "privateFeedbackCount",
      count(*) FILTER (
        WHERE metric_key = 'portal.review_link_click'
          AND effective_value = 1
          AND portal_destination_kind = 'google_review'
      )::bigint AS "googleReviewSelectionCount",
      count(*) FILTER (
        WHERE metric_key = 'portal.review_link_click'
          AND effective_value = 1
          AND portal_destination_kind = 'secondary_link'
      )::bigint AS "secondaryLinkSelectionCount",
      count(*) FILTER (
        WHERE effective_value IS NOT NULL AND NOT (
          (metric_key = 'portal.qualified_scan' AND effective_value = 1
            AND portal_destination_kind IS NULL)
          OR (metric_key = 'portal.rating' AND effective_value BETWEEN 1 AND 5
            AND effective_value = trunc(effective_value)
            AND portal_destination_kind IS NULL)
          OR (metric_key = 'portal.feedback' AND effective_value = 1
            AND portal_destination_kind IS NULL)
          OR (metric_key = 'portal.review_link_click' AND effective_value = 1
            AND portal_destination_kind IN ('google_review', 'secondary_link'))
        )
      )::bigint AS "invalidFactCount"
    FROM effective
  `)
  const row = (result.rows as unknown as AggregateQueryRow[])[0]
  if (n(row?.invalidFactCount) > 0) {
    throw new Error(
      'Portal lifetime rebuild found an invalid governed Portal lifetime fact',
    )
  }
  return valuesFromAggregateRow(row)
}

function reconciliation(
  scope: PortalLifetimeScope,
  beforeRow: PortalLifetimeStoredRow | null,
  afterRow: PortalLifetimeStoredRow,
): PortalLifetimeReconciliation {
  const before = beforeRow ? toAggregate(scope, beforeRow) : null
  return {
    before,
    after: toAggregate(scope, afterRow),
    matched: before !== null && valuesEqual(before.values, afterRow.values),
  }
}

function validLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export const createPortalLifetimeAggregateRepository = (
  db: Database,
  clock: () => Date,
): PortalLifetimeAggregatePort => ({
  async get(scope) {
    return trace('metric.portalLifetime.get', async () => {
      const result = await db.execute(sql`
        SELECT
          qualified_scan_count AS "qualifiedScanCount",
          private_rating_count AS "privateRatingCount",
          private_rating_sum AS "privateRatingSum",
          private_rating_1_count AS "privateRating1Count",
          private_rating_2_count AS "privateRating2Count",
          private_rating_3_count AS "privateRating3Count",
          private_rating_4_count AS "privateRating4Count",
          private_rating_5_count AS "privateRating5Count",
          private_feedback_count AS "privateFeedbackCount",
          google_review_selection_count AS "googleReviewSelectionCount",
          secondary_link_selection_count AS "secondaryLinkSelectionCount",
          sealed_qualified_scan_count AS "sealedQualifiedScanCount",
          sealed_private_rating_count AS "sealedPrivateRatingCount",
          sealed_private_rating_sum AS "sealedPrivateRatingSum",
          sealed_private_rating_1_count AS "sealedPrivateRating1Count",
          sealed_private_rating_2_count AS "sealedPrivateRating2Count",
          sealed_private_rating_3_count AS "sealedPrivateRating3Count",
          sealed_private_rating_4_count AS "sealedPrivateRating4Count",
          sealed_private_rating_5_count AS "sealedPrivateRating5Count",
          sealed_private_feedback_count AS "sealedPrivateFeedbackCount",
          sealed_google_review_selection_count AS "sealedGoogleReviewSelectionCount",
          sealed_secondary_link_selection_count AS "sealedSecondaryLinkSelectionCount",
          sealed_through_local_date AS "sealedThroughLocalDate",
          projection_revision AS "projectionRevision",
          last_rebuilt_at AS "lastRebuiltAt",
          last_sealed_at AS "lastSealedAt"
        FROM portal_metric_lifetime_aggregates
        WHERE organization_id = ${scope.organizationId}
          AND property_id = ${scope.propertyId}
          AND portal_id = ${scope.portalId}
      `)
      const row = (
        result.rows as unknown as Parameters<typeof portalLifetimeStoredRow>[0][]
      )[0]
      return row ? toAggregate(scope, portalLifetimeStoredRow(row)) : null
    })
  },

  async inspect(scope) {
    return trace('metric.portalLifetime.inspect', async () =>
      db.transaction(async (tx) => {
        const database = tx as unknown as Database
        await lockPortalLifetimeAggregate(database, scope)
        const current = await readPortalLifetimeAggregateForUpdate(database, scope)
        const retained = await readEffectiveValues(database, scope, {
          fromLocalDate: current.sealedThroughLocalDate,
          toLocalDate: null,
        })
        const expectedValues = applyPortalLifetimeContribution(
          current.sealedValues,
          retained,
        )
        return {
          current: toAggregate(scope, current),
          expectedValues,
          matched: valuesEqual(current.values, expectedValues),
        }
      }),
    )
  },

  async rebuild(scope) {
    return trace('metric.portalLifetime.rebuild', async () =>
      db.transaction(async (tx) => {
        const database = tx as unknown as Database
        await lockPortalLifetimeAggregate(database, scope)
        const before = await readPortalLifetimeAggregateForUpdate(database, scope)
        const retained = await readEffectiveValues(database, scope, {
          fromLocalDate: before.sealedThroughLocalDate,
          toLocalDate: null,
        })
        const rebuiltValues = applyPortalLifetimeContribution(
          before.sealedValues,
          retained,
        )
        const at = clock()
        const after: PortalLifetimeStoredRow = {
          ...before,
          values: rebuiltValues,
          projectionRevision: before.projectionRevision + 1,
          lastRebuiltAt: at,
        }
        await writePortalLifetimeAggregate(database, scope, after, {
          lastRebuiltAt: at,
        })
        return reconciliation(scope, before, after)
      }),
    )
  },

  async sealThrough(scope, throughLocalDate) {
    if (!validLocalDate(throughLocalDate)) {
      throw new Error('Portal lifetime seal boundary is invalid')
    }
    return trace('metric.portalLifetime.sealThrough', async () =>
      db.transaction(async (tx) => {
        const database = tx as unknown as Database
        await lockPortalLifetimeAggregate(database, scope)
        const before = await readPortalLifetimeAggregateForUpdate(database, scope)
        if (
          before.sealedThroughLocalDate !== null &&
          throughLocalDate < before.sealedThroughLocalDate
        ) {
          throw new Error('Portal lifetime seal boundary cannot move backwards')
        }
        const newlySealed =
          throughLocalDate === before.sealedThroughLocalDate
            ? emptyPortalLifetimeValues()
            : await readEffectiveValues(database, scope, {
                fromLocalDate: before.sealedThroughLocalDate,
                toLocalDate: throughLocalDate,
              })
        const sealedValues = applyPortalLifetimeContribution(
          before.sealedValues,
          newlySealed,
        )
        const retained = await readEffectiveValues(database, scope, {
          fromLocalDate: throughLocalDate,
          toLocalDate: null,
        })
        const at = clock()
        const after: PortalLifetimeStoredRow = {
          values: applyPortalLifetimeContribution(sealedValues, retained),
          sealedValues,
          sealedThroughLocalDate: throughLocalDate,
          projectionRevision: before.projectionRevision + 1,
          lastRebuiltAt: at,
          lastSealedAt: at,
        }
        await writePortalLifetimeAggregate(database, scope, after, {
          lastRebuiltAt: at,
          lastSealedAt: at,
        })
        return reconciliation(scope, before, after)
      }),
    )
  },
})
