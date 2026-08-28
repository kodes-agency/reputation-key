import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { PortalLifetimeScope } from '../application/ports/portal-lifetime-aggregate.port'
import {
  applyPortalLifetimeContribution,
  emptyPortalLifetimeValues,
  sumPortalLifetimeContributions,
  type PortalLifetimeFact,
  type PortalLifetimeValues,
} from '../domain/portal-lifetime-aggregate'

export type PortalLifetimeChange = Readonly<{
  fact: PortalLifetimeFact
  multiplier: 1 | -1
  propertyLocalDate: string
}>

export type PortalLifetimeStoredRow = Readonly<{
  values: PortalLifetimeValues
  sealedValues: PortalLifetimeValues
  sealedThroughLocalDate: string | null
  projectionRevision: number
  lastRebuiltAt?: Date | null
  lastSealedAt?: Date | null
}>

type LifetimeQueryRow = Readonly<{
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
  sealedQualifiedScanCount: unknown
  sealedPrivateRatingCount: unknown
  sealedPrivateRatingSum: unknown
  sealedPrivateRating1Count: unknown
  sealedPrivateRating2Count: unknown
  sealedPrivateRating3Count: unknown
  sealedPrivateRating4Count: unknown
  sealedPrivateRating5Count: unknown
  sealedPrivateFeedbackCount: unknown
  sealedGoogleReviewSelectionCount: unknown
  sealedSecondaryLinkSelectionCount: unknown
  sealedThroughLocalDate: unknown
  projectionRevision: unknown
  lastRebuiltAt?: unknown
  lastSealedAt?: unknown
}>

const number = (value: unknown): number => Number(value ?? 0)

export function portalLifetimeStoredRow(
  row: LifetimeQueryRow | undefined,
): PortalLifetimeStoredRow {
  if (!row) {
    return {
      values: emptyPortalLifetimeValues(),
      sealedValues: emptyPortalLifetimeValues(),
      sealedThroughLocalDate: null,
      projectionRevision: 0,
      lastRebuiltAt: null,
      lastSealedAt: null,
    }
  }
  return {
    values: {
      qualifiedScanCount: number(row.qualifiedScanCount),
      privateRatingCount: number(row.privateRatingCount),
      privateRatingSum: number(row.privateRatingSum),
      privateRating1Count: number(row.privateRating1Count),
      privateRating2Count: number(row.privateRating2Count),
      privateRating3Count: number(row.privateRating3Count),
      privateRating4Count: number(row.privateRating4Count),
      privateRating5Count: number(row.privateRating5Count),
      privateFeedbackCount: number(row.privateFeedbackCount),
      googleReviewSelectionCount: number(row.googleReviewSelectionCount),
      secondaryLinkSelectionCount: number(row.secondaryLinkSelectionCount),
    },
    sealedValues: {
      qualifiedScanCount: number(row.sealedQualifiedScanCount),
      privateRatingCount: number(row.sealedPrivateRatingCount),
      privateRatingSum: number(row.sealedPrivateRatingSum),
      privateRating1Count: number(row.sealedPrivateRating1Count),
      privateRating2Count: number(row.sealedPrivateRating2Count),
      privateRating3Count: number(row.sealedPrivateRating3Count),
      privateRating4Count: number(row.sealedPrivateRating4Count),
      privateRating5Count: number(row.sealedPrivateRating5Count),
      privateFeedbackCount: number(row.sealedPrivateFeedbackCount),
      googleReviewSelectionCount: number(row.sealedGoogleReviewSelectionCount),
      secondaryLinkSelectionCount: number(row.sealedSecondaryLinkSelectionCount),
    },
    sealedThroughLocalDate:
      typeof row.sealedThroughLocalDate === 'string' ? row.sealedThroughLocalDate : null,
    projectionRevision: number(row.projectionRevision),
    lastRebuiltAt:
      row.lastRebuiltAt instanceof Date
        ? row.lastRebuiltAt
        : row.lastRebuiltAt
          ? new Date(String(row.lastRebuiltAt))
          : null,
    lastSealedAt:
      row.lastSealedAt instanceof Date
        ? row.lastSealedAt
        : row.lastSealedAt
          ? new Date(String(row.lastSealedAt))
          : null,
  }
}

export async function lockPortalLifetimeAggregate(
  tx: Pick<Database, 'execute'>,
  scope: PortalLifetimeScope,
): Promise<void> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(
        ${`metric-portal-lifetime:${scope.organizationId}:${scope.propertyId}:${scope.portalId}`},
        0
      )
    )
  `)
}

export async function readPortalLifetimeAggregateForUpdate(
  tx: Pick<Database, 'execute'>,
  scope: PortalLifetimeScope,
): Promise<PortalLifetimeStoredRow> {
  const result = await tx.execute(sql`
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
    FOR UPDATE
  `)
  return portalLifetimeStoredRow((result.rows as unknown as LifetimeQueryRow[])[0])
}

export async function writePortalLifetimeAggregate(
  tx: Pick<Database, 'execute'>,
  scope: PortalLifetimeScope,
  row: PortalLifetimeStoredRow,
  operational: Readonly<{
    lastRebuiltAt?: Date | null
    lastSealedAt?: Date | null
  }> = {},
): Promise<void> {
  const values = row.values
  const sealed = row.sealedValues
  await tx.execute(sql`
    INSERT INTO portal_metric_lifetime_aggregates (
      organization_id, property_id, portal_id,
      qualified_scan_count, private_rating_count, private_rating_sum,
      private_rating_1_count, private_rating_2_count, private_rating_3_count,
      private_rating_4_count, private_rating_5_count, private_feedback_count,
      google_review_selection_count, secondary_link_selection_count,
      sealed_qualified_scan_count, sealed_private_rating_count,
      sealed_private_rating_sum, sealed_private_rating_1_count,
      sealed_private_rating_2_count, sealed_private_rating_3_count,
      sealed_private_rating_4_count, sealed_private_rating_5_count,
      sealed_private_feedback_count, sealed_google_review_selection_count,
      sealed_secondary_link_selection_count, sealed_through_local_date,
      projection_revision, last_rebuilt_at, last_sealed_at
    ) VALUES (
      ${scope.organizationId}, ${scope.propertyId}, ${scope.portalId},
      ${values.qualifiedScanCount}, ${values.privateRatingCount},
      ${values.privateRatingSum}, ${values.privateRating1Count},
      ${values.privateRating2Count}, ${values.privateRating3Count},
      ${values.privateRating4Count}, ${values.privateRating5Count},
      ${values.privateFeedbackCount}, ${values.googleReviewSelectionCount},
      ${values.secondaryLinkSelectionCount}, ${sealed.qualifiedScanCount},
      ${sealed.privateRatingCount}, ${sealed.privateRatingSum},
      ${sealed.privateRating1Count}, ${sealed.privateRating2Count},
      ${sealed.privateRating3Count}, ${sealed.privateRating4Count},
      ${sealed.privateRating5Count}, ${sealed.privateFeedbackCount},
      ${sealed.googleReviewSelectionCount}, ${sealed.secondaryLinkSelectionCount},
      ${row.sealedThroughLocalDate}, ${row.projectionRevision},
      ${operational.lastRebuiltAt ?? null}, ${operational.lastSealedAt ?? null}
    )
    ON CONFLICT (organization_id, property_id, portal_id) DO UPDATE SET
      qualified_scan_count = EXCLUDED.qualified_scan_count,
      private_rating_count = EXCLUDED.private_rating_count,
      private_rating_sum = EXCLUDED.private_rating_sum,
      private_rating_1_count = EXCLUDED.private_rating_1_count,
      private_rating_2_count = EXCLUDED.private_rating_2_count,
      private_rating_3_count = EXCLUDED.private_rating_3_count,
      private_rating_4_count = EXCLUDED.private_rating_4_count,
      private_rating_5_count = EXCLUDED.private_rating_5_count,
      private_feedback_count = EXCLUDED.private_feedback_count,
      google_review_selection_count = EXCLUDED.google_review_selection_count,
      secondary_link_selection_count = EXCLUDED.secondary_link_selection_count,
      sealed_qualified_scan_count = EXCLUDED.sealed_qualified_scan_count,
      sealed_private_rating_count = EXCLUDED.sealed_private_rating_count,
      sealed_private_rating_sum = EXCLUDED.sealed_private_rating_sum,
      sealed_private_rating_1_count = EXCLUDED.sealed_private_rating_1_count,
      sealed_private_rating_2_count = EXCLUDED.sealed_private_rating_2_count,
      sealed_private_rating_3_count = EXCLUDED.sealed_private_rating_3_count,
      sealed_private_rating_4_count = EXCLUDED.sealed_private_rating_4_count,
      sealed_private_rating_5_count = EXCLUDED.sealed_private_rating_5_count,
      sealed_private_feedback_count = EXCLUDED.sealed_private_feedback_count,
      sealed_google_review_selection_count =
        EXCLUDED.sealed_google_review_selection_count,
      sealed_secondary_link_selection_count =
        EXCLUDED.sealed_secondary_link_selection_count,
      sealed_through_local_date = EXCLUDED.sealed_through_local_date,
      projection_revision = EXCLUDED.projection_revision,
      last_rebuilt_at = COALESCE(EXCLUDED.last_rebuilt_at,
        portal_metric_lifetime_aggregates.last_rebuilt_at),
      last_sealed_at = COALESCE(EXCLUDED.last_sealed_at,
        portal_metric_lifetime_aggregates.last_sealed_at),
      updated_at = now()
  `)
}

/** Apply reading/correction deltas under the same transaction as state+outbox. */
export async function applyPortalLifetimeChanges(
  tx: Pick<Database, 'execute'>,
  scope: PortalLifetimeScope,
  changes: readonly PortalLifetimeChange[],
): Promise<void> {
  if (changes.length === 0) return
  await lockPortalLifetimeAggregate(tx, scope)
  const current = await readPortalLifetimeAggregateForUpdate(tx, scope)
  await writePortalLifetimeAggregate(
    tx,
    scope,
    applyPortalLifetimeChangeSet(current, changes),
  )
}

export function applyPortalLifetimeChangeSet(
  current: PortalLifetimeStoredRow,
  changes: readonly PortalLifetimeChange[],
): PortalLifetimeStoredRow {
  let totalDelta = emptyPortalLifetimeValues()
  let sealedDelta = emptyPortalLifetimeValues()
  for (const change of changes) {
    totalDelta = sumPortalLifetimeContributions(
      totalDelta,
      change.fact.contribution,
      change.multiplier,
    )
    if (
      current.sealedThroughLocalDate !== null &&
      change.propertyLocalDate < current.sealedThroughLocalDate
    ) {
      sealedDelta = sumPortalLifetimeContributions(
        sealedDelta,
        change.fact.contribution,
        change.multiplier,
      )
    }
  }
  return {
    values: applyPortalLifetimeContribution(current.values, totalDelta),
    sealedValues: applyPortalLifetimeContribution(current.sealedValues, sealedDelta),
    sealedThroughLocalDate: current.sealedThroughLocalDate,
    projectionRevision: current.projectionRevision + 1,
  }
}
