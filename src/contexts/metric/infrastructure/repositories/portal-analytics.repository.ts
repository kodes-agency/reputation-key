// Metric context — governed Portal analytics repository.
// This owner pins immutable definition versions, registry consumer/source
// policy, exact quality, current correction tips, half-open business time,
// tenant scope, and a statement-level budget.
// TRAP: `metricReadings.occurredAt` is the INGESTION column (`recorded_at`);
// the guest-action time is `metricReadings.eventAt`; every period below is
// bounded on that business timestamp.

import type { Database } from '#/shared/db'
import {
  metricCorrections,
  metricDefinitionVersions,
  metricReadings,
} from '#/shared/db/schema'
import { and, avg, count, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import { trace } from '#/shared/observability/trace'
import type {
  PortalAnalyticsRepository,
  PortalMetricEvidence,
  PortalMetricEvidenceSet,
  PortalMetricFamily,
  PortalRatingBucket,
  PortalRatingTrendPoint,
} from '../../application/ports/portal-analytics.repository'
import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'

const METRIC_PORTAL_READ_BUDGET_MS = 5_000

function metricPortalWhere(
  organizationId: OrganizationId,
  propertyId: PropertyId,
  portalId: PortalId,
  startDate: Date,
  endDate: Date,
) {
  return and(
    eq(metricReadings.organizationId, organizationId),
    eq(metricReadings.propertyId, propertyId),
    eq(metricReadings.portalId, portalId),
    gte(metricReadings.eventAt, startDate),
    lt(metricReadings.eventAt, endDate),
  )
}

async function withStatementTimeout<T>(
  db: Database,
  read: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('statement_timeout', ${String(METRIC_PORTAL_READ_BUDGET_MS)}, true)`,
    )
    return read(tx as unknown as Database)
  })
}

const PORTAL_RATING_KEY = 'portal.rating'
const PORTAL_ANALYTICS_VERSION_IDS = [
  METRIC_VERSION_IDS.portalScanAnalytics,
  METRIC_VERSION_IDS.portalRatingAnalytics,
  METRIC_VERSION_IDS.portalFeedbackAnalytics,
  METRIC_VERSION_IDS.portalDestinationClickAnalytics,
] as const

type EvidenceRow = Readonly<{
  family: unknown
  definition_version_id: unknown
  source_count: unknown
  applied_count: unknown
  obsolete_present: unknown
  quarantine_present: unknown
  projection_missing: unknown
  invalid_reading_count: unknown
  latest_activity: unknown
  correction_head: unknown
}>

function dateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) {
    throw new Error('Portal metric evidence contains an invalid timestamp')
  }
  return date
}

/** The first condition that makes this family's evidence unusable, if any. */
function unavailableEvidenceReason(
  row: EvidenceRow,
  invalidReadingCount: number,
): string | null {
  if (row.quarantine_present === true) return 'source_fact_quarantined'
  if (invalidReadingCount > 0) return 'invalid_governed_reading'
  if (row.obsolete_present === true) return 'source_fact_obsolete'
  if (row.projection_missing === true) return 'projection_missing'
  return null
}

function evidenceState(row: EvidenceRow, computedAt: Date): PortalMetricEvidence {
  if (typeof row.definition_version_id !== 'string') {
    throw new Error('Portal metric evidence definition is invalid')
  }
  const sourceCount = Number(row.source_count ?? 0)
  const appliedCount = Number(row.applied_count ?? 0)
  const invalidReadingCount = Number(row.invalid_reading_count ?? 0)
  const unavailableReason = unavailableEvidenceReason(row, invalidReadingCount)
  const state =
    unavailableReason !== null
      ? 'unavailable'
      : appliedCount < sourceCount
        ? 'updating'
        : 'ready'
  return {
    definitionVersionId: row.definition_version_id,
    state,
    verifiedThrough: state === 'ready' ? computedAt : null,
    latestActivity: dateOrNull(row.latest_activity),
    computedAt,
    completeness:
      sourceCount === 0 ? 1 : Math.min(1, Math.max(0, appliedCount / sourceCount)),
    availabilityReason:
      unavailableReason ?? (state === 'updating' ? 'consumer_receipt_pending' : null),
    correctionHead: dateOrNull(row.correction_head),
  }
}

function isPortalMetricFamily(value: unknown): value is PortalMetricFamily {
  return (
    value === 'scans' ||
    value === 'privateRatings' ||
    value === 'privateFeedback' ||
    value === 'reviewLinkClicks'
  )
}

function currentCorrectionTips(db: Database) {
  return db
    .select({
      readingId: metricCorrections.readingId,
      kind: metricCorrections.kind,
      exactDelta: metricCorrections.exactDelta,
      replacementValue: metricCorrections.replacementValue,
    })
    .from(metricCorrections)
    .where(
      sql`NOT EXISTS (
        SELECT 1
        FROM metric_corrections AS successor
        WHERE successor.supersedes_correction_id = ${metricCorrections.id}
      )`,
    )
    .as('portal_metric_correction_tips')
}

type CorrectionTips = ReturnType<typeof currentCorrectionTips>

function effectiveValue(correctionTips: CorrectionTips) {
  return sql<number>`CASE
    WHEN ${correctionTips.kind} = 'retract' THEN NULL
    WHEN ${correctionTips.kind} = 'replace' THEN ${correctionTips.replacementValue}
    WHEN ${correctionTips.kind} = 'adjust'
      THEN ${metricReadings.exactValue} + ${correctionTips.exactDelta}
    ELSE ${metricReadings.exactValue}
  END`
}

function governedPortalWhere(scope: ReturnType<typeof metricPortalWhere>) {
  return and(
    scope,
    inArray(metricReadings.definitionVersionId, PORTAL_ANALYTICS_VERSION_IDS),
    isNotNull(metricReadings.exactValue),
    eq(metricReadings.dataQuality, 'exact'),
    sql`${metricReadings.attributionQuality} <> 'unresolved'`,
    sql`${metricDefinitionVersions.permittedConsumers} @> '["portal_analytics"]'::jsonb`,
    sql`EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(
        ${metricDefinitionVersions.sourcePolicyAllowlist}
      ) AS allowed_policy(value)
      WHERE allowed_policy.value = ${metricReadings.sourcePolicy}
    )`,
  )
}

export const createPortalAnalyticsRepository = (
  db: Database,
  clock: () => Date,
): PortalAnalyticsRepository => ({
  async getPortalKpiSums(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
  ) {
    return trace('metric.portalAnalytics.getPortalKpiSums', async () => {
      const correctionTips = currentCorrectionTips(db)
      const value = effectiveValue(correctionTips)
      const scope = governedPortalWhere(
        metricPortalWhere(organizationId, propertyId, portalId, startDate, endDate),
      )
      const rows = await withStatementTimeout(db, (tx) =>
        tx
          .select({
            metricKey: metricReadings.metricKey,
            total: sql<number>`SUM(${value})`,
            count: count(value),
          })
          .from(metricReadings)
          .innerJoin(
            metricDefinitionVersions,
            eq(metricDefinitionVersions.id, metricReadings.definitionVersionId),
          )
          .leftJoin(correctionTips, eq(correctionTips.readingId, metricReadings.id))
          .where(
            and(
              scope,
              sql`(${metricReadings.metricKey} <> ${PORTAL_RATING_KEY}
                OR (${value} BETWEEN 1 AND 5 AND ${value} = TRUNC(${value})))`,
            ),
          )
          .groupBy(metricReadings.metricKey),
      )
      return rows.map((row) => ({
        metricKey: row.metricKey,
        total: Number(row.total ?? 0),
        count: Number(row.count ?? 0),
      }))
    })
  },

  async getPortalRatingDistribution(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
  ): Promise<readonly PortalRatingBucket[]> {
    return trace('metric.portalAnalytics.getPortalRatingDistribution', async () => {
      const correctionTips = currentCorrectionTips(db)
      const value = effectiveValue(correctionTips)
      const ratingStars = sql<number>`CAST(${value} AS INTEGER)`
      const rows = await withStatementTimeout(db, (tx) =>
        tx
          .select({
            stars: ratingStars,
            count: count(),
          })
          .from(metricReadings)
          .innerJoin(
            metricDefinitionVersions,
            eq(metricDefinitionVersions.id, metricReadings.definitionVersionId),
          )
          .leftJoin(correctionTips, eq(correctionTips.readingId, metricReadings.id))
          .where(
            and(
              governedPortalWhere(
                metricPortalWhere(
                  organizationId,
                  propertyId,
                  portalId,
                  startDate,
                  endDate,
                ),
              ),
              eq(metricReadings.metricKey, PORTAL_RATING_KEY),
              sql`${value} BETWEEN 1 AND 5 AND ${value} = TRUNC(${value})`,
            ),
          )
          .groupBy(ratingStars)
          .orderBy(ratingStars),
      )

      return rows.map((r) => ({
        stars: Number(r.stars),
        count: Number(r.count),
      }))
    })
  },

  async getPortalRatingTrend(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
  ): Promise<readonly PortalRatingTrendPoint[]> {
    return trace('metric.portalAnalytics.getPortalRatingTrend', async () => {
      const correctionTips = currentCorrectionTips(db)
      const value = effectiveValue(correctionTips)
      const rows = await withStatementTimeout(db, (tx) =>
        tx
          .select({
            // property_local_date is computed per row from properties.timezone
            // (metric/infrastructure/repositories/property-local-date.ts) off the
            // EVENT time, and is required by the governed-provenance CHECK. Bucket
            // on it rather than DATE(recorded_at): the latter is the ingestion
            // timestamp evaluated in the UTC session timezone, so for a property in
            // e.g. America/Los_Angeles every action from 17:00 local onward landed
            // on the next day.
            date: metricReadings.propertyLocalDate,
            avgRating: sql<number>`ROUND(${avg(value)}::NUMERIC, 1)`,
          })
          .from(metricReadings)
          .innerJoin(
            metricDefinitionVersions,
            eq(metricDefinitionVersions.id, metricReadings.definitionVersionId),
          )
          .leftJoin(correctionTips, eq(correctionTips.readingId, metricReadings.id))
          .where(
            and(
              governedPortalWhere(
                metricPortalWhere(
                  organizationId,
                  propertyId,
                  portalId,
                  startDate,
                  endDate,
                ),
              ),
              eq(metricReadings.metricKey, PORTAL_RATING_KEY),
              isNotNull(metricReadings.propertyLocalDate),
              sql`${value} BETWEEN 1 AND 5 AND ${value} = TRUNC(${value})`,
            ),
          )
          .groupBy(metricReadings.propertyLocalDate)
          .orderBy(metricReadings.propertyLocalDate),
      )

      // property_local_date is nullable in drizzle (pre-governance legacy rows);
      // the isNotNull predicate above already excludes them, so this narrows
      // without an assertion rather than inventing a date.
      return rows.flatMap((r) =>
        r.date === null ? [] : [{ date: r.date, avgRating: Number(r.avgRating ?? 0) }],
      )
    })
  },

  async getPortalMetricEvidence(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
  ): Promise<PortalMetricEvidenceSet> {
    return trace('metric.portalAnalytics.getPortalMetricEvidence', async () => {
      const computedAt = clock()
      const result = await withStatementTimeout(db, (tx) =>
        tx.execute(sql`
          WITH families (
            family, definition_version_id, metric_key, event_types
          ) AS (
            VALUES
              (
                'scans', ${METRIC_VERSION_IDS.portalScanAnalytics}::uuid,
                'portal.scan', ARRAY['guest.scan.recorded']::text[]
              ),
              (
                'privateRatings', ${METRIC_VERSION_IDS.portalRatingAnalytics}::uuid,
                'portal.rating', ARRAY[
                  'guest.rating.submitted', 'guest.rating.retracted'
                ]::text[]
              ),
              (
                'privateFeedback', ${METRIC_VERSION_IDS.portalFeedbackAnalytics}::uuid,
                'portal.feedback', ARRAY[
                  'guest.feedback.submitted', 'guest.feedback.retracted'
                ]::text[]
              ),
              (
                'reviewLinkClicks', ${METRIC_VERSION_IDS.portalDestinationClickAnalytics}::uuid,
                'portal.review_link_click', ARRAY['guest.review_link.clicked']::text[]
              )
          ), source_status AS (
            SELECT
              families.family,
              count(DISTINCT source.id) AS source_count,
              count(DISTINCT source.id) FILTER (
                WHERE receipt.status IN ('applied', 'duplicate')
              ) AS applied_count,
              bool_or(coalesce(receipt.status = 'obsolete', false)) AS obsolete_present,
              bool_or(quarantine.id IS NOT NULL) AS quarantine_present,
              bool_or(
                coalesce(receipt.status IN ('applied', 'duplicate'), false)
                AND CASE
                  WHEN source.event_type LIKE '%.retracted' THEN NOT EXISTS (
                    SELECT 1
                    FROM metric_corrections AS expected_correction
                    JOIN metric_readings AS corrected_reading
                      ON corrected_reading.id = expected_correction.reading_id
                    WHERE expected_correction.source_event_id =
                            source.id::text || ':' || families.definition_version_id::text
                      AND expected_correction.kind = 'retract'
                      AND corrected_reading.definition_version_id =
                            families.definition_version_id
                      AND corrected_reading.source_event_id =
                            source.payload ->> 'supersedesSourceEventId'
                      AND corrected_reading.organization_id = ${organizationId}
                      AND corrected_reading.property_id = ${propertyId}
                      AND corrected_reading.portal_id = ${portalId}
                  )
                  ELSE
                    NOT EXISTS (
                      SELECT 1
                      FROM metric_readings AS expected_reading
                      WHERE expected_reading.definition_version_id =
                              families.definition_version_id
                        AND expected_reading.source_event_id = source.id::text
                        AND expected_reading.organization_id = ${organizationId}
                        AND expected_reading.property_id = ${propertyId}
                        AND expected_reading.portal_id = ${portalId}
                    )
                    OR (
                      source.payload ->> 'supersedesSourceEventId' IS NOT NULL
                      AND NOT EXISTS (
                        SELECT 1
                        FROM metric_corrections AS replacement_correction
                        JOIN metric_readings AS superseded_reading
                          ON superseded_reading.id = replacement_correction.reading_id
                        WHERE replacement_correction.source_event_id =
                                source.id::text || ':retract'
                          AND replacement_correction.kind = 'retract'
                          AND superseded_reading.definition_version_id =
                                families.definition_version_id
                          AND superseded_reading.source_event_id =
                                source.payload ->> 'supersedesSourceEventId'
                          AND superseded_reading.organization_id = ${organizationId}
                          AND superseded_reading.property_id = ${propertyId}
                          AND superseded_reading.portal_id = ${portalId}
                      )
                    )
                END
              ) AS projection_missing,
              max((source.payload ->> 'occurredAt')::timestamptz) AS latest_activity
            FROM families
            LEFT JOIN outbox_events AS source
              ON source.organization_id = ${organizationId}
             AND source.property_id = ${propertyId}
             AND source.source_context = 'guest'
             AND source.event_type = ANY(families.event_types)
             AND source.payload ->> 'portalId' = ${portalId}
             AND (source.payload ->> 'occurredAt')::timestamptz >= ${startDate}
             AND (source.payload ->> 'occurredAt')::timestamptz < ${endDate}
            LEFT JOIN event_consumer_receipts AS receipt
              ON receipt.event_id = source.id
             AND receipt.consumer_name = 'metric.guest-analytics'
            LEFT JOIN metric_quarantine AS quarantine
              ON quarantine.source_event_id = source.id::text
             AND quarantine.definition_version_id = families.definition_version_id
             AND quarantine.resolved_at IS NULL
            GROUP BY families.family
          ), reading_status AS (
            SELECT
              families.family,
              count(DISTINCT reading.id) FILTER (
                WHERE (
                  reading.definition_version_id = families.definition_version_id
                  AND reading.metric_key = families.metric_key
                  AND reading.exact_value IS NOT NULL
                  AND reading.data_quality = 'exact'
                  AND reading.attribution_quality <> 'unresolved'
                  AND EXISTS (
                    SELECT 1
                    FROM metric_definition_versions AS version
                    WHERE version.id = reading.definition_version_id
                      AND version.permitted_consumers @> '["portal_analytics"]'::jsonb
                      AND EXISTS (
                        SELECT 1
                        FROM jsonb_array_elements_text(
                          version.source_policy_allowlist
                        ) AS allowed_policy(value)
                        WHERE allowed_policy.value = reading.source_policy
                      )
                  )
                  AND (
                    families.family <> 'privateRatings'
                    OR (
                      reading.exact_value BETWEEN 1 AND 5
                      AND reading.exact_value = trunc(reading.exact_value)
                    )
                  )
                ) IS NOT TRUE
              ) AS invalid_reading_count,
              max(correction.recorded_at) AS correction_head
            FROM families
            LEFT JOIN metric_readings AS reading
              ON reading.organization_id = ${organizationId}
             AND reading.property_id = ${propertyId}
             AND reading.portal_id = ${portalId}
             AND reading.metric_key = families.metric_key
             AND reading.event_at >= ${startDate}
             AND reading.event_at < ${endDate}
            LEFT JOIN metric_corrections AS correction
              ON correction.reading_id = reading.id
            GROUP BY families.family
          )
          SELECT
            families.family,
            families.definition_version_id,
            source_status.source_count,
            source_status.applied_count,
            source_status.obsolete_present,
            source_status.quarantine_present,
            source_status.projection_missing,
            reading_status.invalid_reading_count,
            source_status.latest_activity,
            reading_status.correction_head
          FROM families
          JOIN source_status USING (family)
          JOIN reading_status USING (family)
        `),
      )

      const parsed = {} as Record<PortalMetricFamily, PortalMetricEvidence>
      for (const row of result.rows as EvidenceRow[]) {
        if (!isPortalMetricFamily(row.family)) {
          throw new Error('Portal metric evidence family is invalid')
        }
        parsed[row.family] = evidenceState(row, computedAt)
      }
      if (
        !parsed.scans ||
        !parsed.privateRatings ||
        !parsed.privateFeedback ||
        !parsed.reviewLinkClicks
      ) {
        throw new Error('Portal metric evidence is incomplete')
      }
      return parsed
    })
  },
})
