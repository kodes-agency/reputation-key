// Metric context — what every governed Portal analytics read agrees on.
//
// One Portal's Results view and the batched Portals overview must count the
// same things the same way, so the definitions they share live here: which
// metric versions and source policies are admitted, how the current correction
// for a reading is found, what makes a reading a Google open or a valid rating,
// and how one family's evidence row becomes a state.
// TRAP: `metricReadings.occurredAt` is the INGESTION column (`recorded_at`);
// the guest-action time is `metricReadings.eventAt`.

import type { Database, Tx } from '#/shared/db'
import { metricCorrections, metricReadings } from '#/shared/db/schema'
import { and, eq, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm'
import type {
  MetricPortalMetricEvidence,
  MetricPortalMetricEvidenceSet,
  PortalMetricFamily,
} from '../../application/ports/portal-analytics.repository'
import {
  METRIC_VERSION_IDS,
  findMetricVersionById,
  type GovernedMetricVersion,
} from '../../domain/metric-registry'

const METRIC_PORTAL_READ_BUDGET_MS = 5_000

export async function withStatementTimeout<T>(
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

export type PortalMetricPolicy = Readonly<{
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
export const QUALIFIED_SCAN_POLICY = portalMetricPolicy(
  METRIC_VERSION_IDS.qualifiedScanGoal,
)
export const PORTAL_RATING_POLICY = portalMetricPolicy(
  METRIC_VERSION_IDS.portalRatingAnalytics,
)
export const PORTAL_FEEDBACK_POLICY = portalMetricPolicy(
  METRIC_VERSION_IDS.portalFeedbackAnalytics,
)
export const PORTAL_DESTINATION_CLICK_POLICY = portalMetricPolicy(
  METRIC_VERSION_IDS.portalDestinationClickAnalytics,
)
const PORTAL_ANALYTICS_POLICIES = Object.freeze([
  QUALIFIED_SCAN_POLICY,
  PORTAL_RATING_POLICY,
  PORTAL_FEEDBACK_POLICY,
  PORTAL_DESTINATION_CLICK_POLICY,
])
export const PORTAL_ANALYTICS_VERSION_IDS = Object.freeze(
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
export const PORTAL_RATING_KEY = PORTAL_RATING_POLICY.metric.definition.key
export const PORTAL_DESTINATION_CLICK_KEY =
  PORTAL_DESTINATION_CLICK_POLICY.metric.definition.key

/**
 * The `families` rows of the evidence statement: (family, definition version,
 * metric key, admitted source policies, source fact types), one per Portal
 * metric family. Built from the pinned definitions this module owns.
 */
export function portalEvidenceFamilies(): SQL {
  return sql`
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
  `
}

/** Evidence reason when click readings never recorded which link was opened. */
const DESTINATION_UNATTRIBUTED_REASON = 'destination_unattributed'

export type EvidenceRow = Readonly<{
  /** Present on the batched statement, which answers for several Portals. */
  portal_id?: unknown
  family: unknown
  definition_version_id: unknown
  source_count?: unknown
  applied_count?: unknown
  obsolete_present?: unknown
  projection_missing?: unknown
  invalid_reading_count?: unknown
  latest_activity?: unknown
  correction_head?: unknown
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

export function evidenceState(
  row: EvidenceRow,
  computedAt: Date,
): MetricPortalMetricEvidence {
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
export function withDestinationAttribution(
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

const PORTAL_METRIC_FAMILIES = Object.freeze({
  scans: QUALIFIED_SCAN_POLICY,
  privateRatings: PORTAL_RATING_POLICY,
  privateFeedback: PORTAL_FEEDBACK_POLICY,
  reviewLinkClicks: PORTAL_DESTINATION_CLICK_POLICY,
} satisfies Record<PortalMetricFamily, PortalMetricPolicy>)

export function isPortalMetricFamily(value: unknown): value is PortalMetricFamily {
  return (
    value === 'scans' ||
    value === 'privateRatings' ||
    value === 'privateFeedback' ||
    value === 'reviewLinkClicks'
  )
}

export function currentCorrectionTips(db: Database) {
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

export type CorrectionTips = ReturnType<typeof currentCorrectionTips>

export function effectiveValue(correctionTips: CorrectionTips) {
  return sql<number>`CASE
    WHEN ${correctionTips.kind} = 'retract' THEN NULL
    WHEN ${correctionTips.kind} = 'replace' THEN ${correctionTips.replacementValue}
    WHEN ${correctionTips.kind} = 'adjust'
      THEN ${metricReadings.exactValue} + ${correctionTips.exactDelta}
    ELSE ${metricReadings.exactValue}
  END`
}

/** A reading that passes every governed-quality test, inside the given scope. */
export function governedPortalWhere(scope: SQL | undefined) {
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

/**
 * The counted-reading predicate every sum applies on top of `governedPortalWhere`:
 * Google opens only, and a private rating counts only as a whole number of stars.
 */
export function countedPortalReadingWhere(value: SQL<number>) {
  return and(
    GOOGLE_OPENS_ONLY,
    sql`(${metricReadings.metricKey} <> ${PORTAL_RATING_KEY}
      OR (${value} BETWEEN 1 AND 5 AND ${value} = TRUNC(${value})))`,
  )
}

/**
 * Turn the evidence statement's rows into one evidence set per requested
 * Portal. The statement returns a row only where a Portal has something to
 * report for a family; a missing row is a verified zero (no source fact to wait
 * for, no reading to doubt), read here as `ready`. `unattributedClicks` says,
 * per Portal, how many Google-open clicks never recorded their destination.
 */
export function foldEvidenceRows(
  rows: readonly EvidenceRow[],
  portalIds: readonly string[],
  unattributedClicks: ReadonlyMap<string, number>,
  computedAt: Date,
): ReadonlyMap<string, MetricPortalMetricEvidenceSet> {
  const reported = new Map<string, EvidenceRow>()
  for (const row of rows) {
    if (typeof row.portal_id !== 'string' || !isPortalMetricFamily(row.family)) {
      throw new Error('Portal metric evidence row is invalid')
    }
    reported.set(`${row.portal_id}/${row.family}`, row)
  }
  const familyEvidence = (portal: string, family: PortalMetricFamily) =>
    evidenceState(
      reported.get(`${portal}/${family}`) ?? {
        family,
        definition_version_id: PORTAL_METRIC_FAMILIES[family].metric.version.id,
      },
      computedAt,
    )
  return new Map(
    portalIds.map((portal) => [
      portal,
      {
        scans: familyEvidence(portal, 'scans'),
        privateRatings: familyEvidence(portal, 'privateRatings'),
        privateFeedback: familyEvidence(portal, 'privateFeedback'),
        reviewLinkClicks: withDestinationAttribution(
          familyEvidence(portal, 'reviewLinkClicks'),
          unattributedClicks.get(portal) ?? 0,
        ),
      },
    ]),
  )
}
