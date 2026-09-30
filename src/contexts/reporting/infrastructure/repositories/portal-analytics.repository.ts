// Metric context — governed Portal analytics repository.
// This owner pins immutable definition versions, registry consumer/source
// policy, exact quality, current correction tips, half-open business time,
// tenant scope, and a statement-level budget.
// TRAP: `metricReadings.occurredAt` is the INGESTION column (`recorded_at`);
// the guest-action time is `metricReadings.eventAt`; every period below is
// bounded on that business timestamp.

import type { Database, Tx } from '#/shared/db'
import { metricCorrections, metricReadings } from '#/shared/db/schema'
import {
  and,
  avg,
  count,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { trace } from '#/shared/observability/trace'
import { portalMetricEvidenceSql } from './portal-analytics-evidence.sql'
import type {
  MetricPortalMetricEvidence,
  MetricPortalMetricEvidenceSet,
  MetricPortalRatingTrendPoint,
  PortalAnalyticsRepository,
  PortalMetricFamily,
  PortalRatingBucket,
} from '../../application/ports/portal-analytics.repository'
import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'
import {
  METRIC_VERSION_IDS,
  findMetricVersionById,
  type GovernedMetricVersion,
} from '../../domain/metric-registry'

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
  read: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('statement_timeout', ${String(METRIC_PORTAL_READ_BUDGET_MS)}, true)`,
    )
    return read(tx)
  })
}

type PortalMetricPolicy = Readonly<{
  metric: GovernedMetricVersion
  sourcePolicies: SQL
}>

function portalMetricPolicy(versionId: string): PortalMetricPolicy {
  const metric = findMetricVersionById(versionId)
  if (!metric || !metric.version.permittedConsumers.includes('portal_analytics')) {
    throw new Error(`Portal metric catalogue entry is unavailable: ${versionId}`)
  }
  return Object.freeze({
    metric,
    sourcePolicies: sql.join(
      metric.version.sourcePolicyAllowlist.map((policy) => sql`${policy}`),
      sql`, `,
    ),
  })
}

// "Scans" on the Portal results are QUALIFIED scans: server-verified Access
// Artifact arrivals, deduplicated per response session over 24 hours. The raw
// `portal.scan` metric counts every page open (bots, refreshes) and stays out
// of Portal results.
const QUALIFIED_SCAN_POLICY = portalMetricPolicy(METRIC_VERSION_IDS.qualifiedScanGoal)
const PORTAL_RATING_POLICY = portalMetricPolicy(METRIC_VERSION_IDS.portalRatingAnalytics)
const PORTAL_FEEDBACK_POLICY = portalMetricPolicy(
  METRIC_VERSION_IDS.portalFeedbackAnalytics,
)
const PORTAL_DESTINATION_CLICK_POLICY = portalMetricPolicy(
  METRIC_VERSION_IDS.portalDestinationClickAnalytics,
)
const PORTAL_ANALYTICS_POLICIES = Object.freeze([
  QUALIFIED_SCAN_POLICY,
  PORTAL_RATING_POLICY,
  PORTAL_FEEDBACK_POLICY,
  PORTAL_DESTINATION_CLICK_POLICY,
])
const PORTAL_ANALYTICS_VERSION_IDS = Object.freeze(
  PORTAL_ANALYTICS_POLICIES.map(({ metric }) => metric.version.id),
)
const PORTAL_ANALYTICS_POLICY = or(
  ...PORTAL_ANALYTICS_POLICIES.map(({ metric }) =>
    and(
      eq(metricReadings.definitionVersionId, metric.version.id),
      eq(metricReadings.metricKey, metric.definition.key),
      inArray(metricReadings.sourcePolicy, [...metric.version.sourcePolicyAllowlist]),
    ),
  ),
)
if (!PORTAL_ANALYTICS_POLICY) throw new Error('Portal metric catalogue is empty')
const PORTAL_RATING_KEY = PORTAL_RATING_POLICY.metric.definition.key
const PORTAL_DESTINATION_CLICK_KEY = PORTAL_DESTINATION_CLICK_POLICY.metric.definition.key
/** Evidence reason when click readings never recorded which link was opened. */
const DESTINATION_UNATTRIBUTED_REASON = 'destination_unattributed'

type EvidenceRow = Readonly<{
  family: unknown
  definition_version_id: unknown
  source_count: unknown
  applied_count: unknown
  obsolete_present: unknown
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
  if (invalidReadingCount > 0) return 'invalid_governed_reading'
  if (row.obsolete_present === true) return 'source_fact_obsolete'
  if (row.projection_missing === true) return 'projection_missing'
  return null
}

function evidenceState(row: EvidenceRow, computedAt: Date): MetricPortalMetricEvidence {
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

/**
 * Google opens need every click reading to say which link was opened. When some
 * never did, the pipeline is complete but the figure is unanswerable, which is
 * a different state from "updating" or "unavailable". Those stronger states
 * win: an incomplete pipeline is reported as incomplete first.
 */
function withDestinationAttribution(
  evidence: MetricPortalMetricEvidence,
  unattributedClicks: number,
): MetricPortalMetricEvidence {
  if (evidence.state !== 'ready' || unattributedClicks === 0) return evidence
  return {
    ...evidence,
    state: 'insufficient',
    verifiedThrough: null,
    availabilityReason: DESTINATION_UNATTRIBUTED_REASON,
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

function governedPortalWhere(scope: SQL | undefined) {
  return and(
    scope,
    inArray(metricReadings.definitionVersionId, PORTAL_ANALYTICS_VERSION_IDS),
    isNotNull(metricReadings.exactValue),
    eq(metricReadings.dataQuality, 'exact'),
    sql`${metricReadings.attributionQuality} <> 'unresolved'`,
    PORTAL_ANALYTICS_POLICY,
  )
}

/**
 * Destination clicks count as Google opens only when the reading says the
 * destination was the Google review link. A secondary-link click, or a click
 * that never recorded a destination, is not a Google open.
 */
const GOOGLE_OPENS_ONLY = sql`(${metricReadings.metricKey} <> ${PORTAL_DESTINATION_CLICK_KEY}
  OR ${metricReadings.portalDestinationKind} = 'google_review')`

async function countUnattributedClicks(
  db: Database,
  tx: Tx,
  scope: SQL | undefined,
): Promise<number> {
  const correctionTips = currentCorrectionTips(db)
  const value = effectiveValue(correctionTips)
  const [row] = await tx
    .select({ total: count(value) })
    .from(metricReadings)
    .leftJoin(correctionTips, eq(correctionTips.readingId, metricReadings.id))
    .where(
      and(
        governedPortalWhere(scope),
        eq(metricReadings.metricKey, PORTAL_DESTINATION_CLICK_KEY),
        isNull(metricReadings.portalDestinationKind),
      ),
    )
  return Number(row?.total ?? 0)
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
          .leftJoin(correctionTips, eq(correctionTips.readingId, metricReadings.id))
          .where(
            and(
              scope,
              GOOGLE_OPENS_ONLY,
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
  ): Promise<readonly MetricPortalRatingTrendPoint[]> {
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

  async countUnattributedDestinationClicks(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    return trace('metric.portalAnalytics.countUnattributedDestinationClicks', () =>
      withStatementTimeout(db, (tx) =>
        countUnattributedClicks(
          db,
          tx,
          metricPortalWhere(organizationId, propertyId, portalId, startDate, endDate),
        ),
      ),
    )
  },

  async getPortalMetricEvidence(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
  ): Promise<MetricPortalMetricEvidenceSet> {
    return trace('metric.portalAnalytics.getPortalMetricEvidence', async () => {
      const computedAt = clock()
      const { result, unattributedClicks } = await withStatementTimeout(
        db,
        async (tx) => ({
          unattributedClicks: await countUnattributedClicks(
            db,
            tx,
            metricPortalWhere(organizationId, propertyId, portalId, startDate, endDate),
          ),
          result: await tx.execute(
            portalMetricEvidenceSql(
              sql`
              (
                'scans', ${QUALIFIED_SCAN_POLICY.metric.version.id}::uuid,
                ${QUALIFIED_SCAN_POLICY.metric.definition.key},
                ARRAY[${QUALIFIED_SCAN_POLICY.sourcePolicies}]::text[],
                ARRAY['guest.qualified_scan.recorded', 'guest.qualified_scan.retracted']::text[]
              ),
              (
                'privateRatings', ${PORTAL_RATING_POLICY.metric.version.id}::uuid,
                ${PORTAL_RATING_POLICY.metric.definition.key},
                ARRAY[${PORTAL_RATING_POLICY.sourcePolicies}]::text[],
                ARRAY['guest.rating.submitted', 'guest.rating.retracted']::text[]
              ),
              (
                'privateFeedback', ${PORTAL_FEEDBACK_POLICY.metric.version.id}::uuid,
                ${PORTAL_FEEDBACK_POLICY.metric.definition.key},
                ARRAY[${PORTAL_FEEDBACK_POLICY.sourcePolicies}]::text[],
                ARRAY['guest.feedback.submitted', 'guest.feedback.retracted']::text[]
              ),
              (
                'reviewLinkClicks',
                ${PORTAL_DESTINATION_CLICK_POLICY.metric.version.id}::uuid,
                ${PORTAL_DESTINATION_CLICK_POLICY.metric.definition.key},
                ARRAY[${PORTAL_DESTINATION_CLICK_POLICY.sourcePolicies}]::text[],
                ARRAY['guest.review_link.clicked']::text[]
              )
            `,
              { organizationId, propertyId, portalId, startDate, endDate },
            ),
          ),
        }),
      )

      const parsed = {} as Record<PortalMetricFamily, MetricPortalMetricEvidence>
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
      return {
        ...parsed,
        reviewLinkClicks: withDestinationAttribution(
          parsed.reviewLinkClicks,
          unattributedClicks,
        ),
      }
    })
  },
})
