// BQC-7.4 — auxiliary alert reads the OperationsSnapshot does not carry.
//
// Three cheap aggregate reads, gathered once per health-check run (5-min
// cadence) and fed to the pure alert evaluation as AlertAuxReads:
//
//   - retention_runs latest-per-subject outcome (purge/retention failure) —
//     DISTINCT ON (subject), content-free: subject names + outcome only;
//   - delivered, unresolved native-feedback receipts: count and oldest age
//     only. Report text, provider content, identifiers, and attachment bytes
//     are not present in the local triage authority and cannot enter the read;
//   - enabled Review Analysis coverage and actionable empty-enrollment
//     mismatches: property/review counts and oldest progress age only.
//
// Same operational-monitoring seam as health-metrics.ts (raw aggregate SQL
// via Drizzle — the eslint exemption sits next to it). Every sub-read
// degrades independently: a failed read logs a warn and falls back to EMPTY
// (never a fabricated breach) so one hiccup cannot mute the snapshot-based
// alerts — the same degraded-section posture as the operations snapshot.

import { sql } from 'drizzle-orm'
import type pino from 'pino'
import {
  MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1,
  MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1,
} from '#/shared/ai-review-source-contract'
import type { Database } from '#/shared/db'
import { betaFeedbackTriage } from '#/shared/db/schema/beta-feedback-triage.schema'
import { retentionRuns } from '#/shared/db/schema/review-sync.schema'
import type { AlertAuxReads } from '#/shared/observability/alert-definitions'

export type AlertAuxReader = Readonly<{
  read: () => Promise<AlertAuxReads>
}>

export type AlertAuxReaderDeps = Readonly<{
  db: Database
  logger: pino.Logger
}>

/** retention_runs subjects whose LATEST sweep run failed (DISTINCT ON). */
async function readRetentionFailedSubjects(db: Database): Promise<readonly string[]> {
  const result = await db.execute(sql`
    SELECT DISTINCT ON (${retentionRuns.subject})
      ${retentionRuns.subject} AS subject,
      ${retentionRuns.outcome} AS outcome
    FROM ${retentionRuns}
    ORDER BY ${retentionRuns.subject}, ${retentionRuns.startedAt} DESC
  `)
  return result.rows
    .filter((row) => (row as { outcome?: string }).outcome === 'failed')
    .map((row) => String((row as { subject?: string }).subject))
}

async function readBetaFeedbackTriage(
  db: Database,
): Promise<AlertAuxReads['betaFeedbackTriage']> {
  const [row] = await db
    .select({
      deliveredUnresolvedCount: sql<number>`count(*)::int`,
      oldestDeliveredUnresolvedAgeMs: sql<number | null>`
        CASE
          WHEN count(*) = 0 THEN NULL
          ELSE GREATEST(
            0,
            floor(EXTRACT(EPOCH FROM (NOW() - min(${betaFeedbackTriage.createdAt}))) * 1000)
          )::bigint
        END
      `,
    })
    .from(betaFeedbackTriage)
    .where(
      sql`${betaFeedbackTriage.deliveryState} = 'delivered'
        AND ${betaFeedbackTriage.triageState} <> 'resolved'`,
    )

  if (row == null) throw new Error('beta-feedback triage aggregate returned no row')
  const deliveredUnresolvedCount = Number(row.deliveredUnresolvedCount)
  const oldestDeliveredUnresolvedAgeMs =
    row.oldestDeliveredUnresolvedAgeMs == null
      ? null
      : Number(row.oldestDeliveredUnresolvedAgeMs)
  if (
    !Number.isSafeInteger(deliveredUnresolvedCount) ||
    deliveredUnresolvedCount < 0 ||
    (oldestDeliveredUnresolvedAgeMs != null &&
      (!Number.isSafeInteger(oldestDeliveredUnresolvedAgeMs) ||
        oldestDeliveredUnresolvedAgeMs < 0))
  ) {
    throw new Error('beta-feedback triage aggregate returned an invalid reading')
  }
  return {
    monitorAvailable: true,
    deliveredUnresolvedCount,
    oldestDeliveredUnresolvedAgeMs,
  }
}

async function readReviewAnalysisHealth(
  db: Database,
): Promise<AlertAuxReads['reviewAnalysis']> {
  const result = await db.execute(sql`
    WITH enabled_coverage AS (
      SELECT
        auth.organization_id,
        auth.property_id,
        auth.authorized_source_epoch AS source_epoch,
        auth.review_analysis_epoch,
        auth.analysis_start_sequence,
        auth.updated_at AS authorization_updated_at,
        review_head.head_sequence,
        (
          review_head.head_sequence - auth.analysis_start_sequence
        )::bigint AS expected_settlement_count
      FROM merchant_ai_enablement AS auth
      INNER JOIN review_ai_analysis_heads AS review_head
        ON review_head.organization_id = auth.organization_id
       AND review_head.property_id = auth.property_id
       AND review_head.source_epoch = auth.authorized_source_epoch
      WHERE auth.state = 'enabled'
        AND 'review_analysis' = ANY(auth.capabilities)
        AND review_head.head_sequence > auth.analysis_start_sequence
    ),
    coverage AS (
      SELECT
        enabled.organization_id,
        enabled.property_id,
        enabled.source_epoch,
        enabled.review_analysis_epoch,
        enabled.analysis_start_sequence,
        enabled.authorization_updated_at,
        enabled.head_sequence,
        enabled.expected_settlement_count,
        count(settlement.analysis_sequence)::bigint AS settled_count,
        max(settlement.settled_at) AS last_settled_at
      FROM enabled_coverage AS enabled
      LEFT JOIN ai_property_aggregate_settlements AS settlement
        ON settlement.organization_id = enabled.organization_id
       AND settlement.property_id = enabled.property_id
       AND settlement.source_epoch = enabled.source_epoch
       AND settlement.review_analysis_epoch = enabled.review_analysis_epoch
      GROUP BY
        enabled.organization_id,
        enabled.property_id,
        enabled.source_epoch,
        enabled.review_analysis_epoch,
        enabled.analysis_start_sequence,
        enabled.authorization_updated_at,
        enabled.head_sequence,
        enabled.expected_settlement_count
    ),
    incomplete AS (
      SELECT
        coverage.*,
        (
          coverage.expected_settlement_count - coverage.settled_count
        )::bigint AS pending_settlement_count
      FROM coverage
      WHERE coverage.settled_count < coverage.expected_settlement_count
    ),
    progress AS (
      SELECT
        incomplete.pending_settlement_count,
        GREATEST(
          COALESCE(
            incomplete.last_settled_at,
            incomplete.authorization_updated_at
          ),
          COALESCE(
            pending.oldest_pending_at,
            incomplete.authorization_updated_at
          )
        ) AS last_progress_at
      FROM incomplete
      LEFT JOIN LATERAL (
        SELECT min(event.created_at) AS oldest_pending_at
        FROM outbox_events AS event
        WHERE event.organization_id = incomplete.organization_id
          AND event.property_id = incomplete.property_id::text
          AND event.event_type IN (
            'review.created',
            'review.updated',
            'review.source_transitioned',
            'ai.review_analysis.backfill_requested'
          )
          AND event.payload->>'sourceEpoch' ~ '^[0-9]+$'
          AND (event.payload->>'sourceEpoch')::numeric = incomplete.source_epoch
          AND event.payload->>'analysisSequence' ~ '^[1-9][0-9]*$'
          AND (event.payload->>'analysisSequence')::numeric
            > incomplete.analysis_start_sequence
          AND (event.payload->>'analysisSequence')::numeric
            <= incomplete.head_sequence
          AND NOT EXISTS (
            SELECT 1
            FROM ai_property_aggregate_settlements AS settled
            WHERE settled.organization_id = incomplete.organization_id
              AND settled.property_id = incomplete.property_id
              AND settled.source_epoch = incomplete.source_epoch
              AND settled.review_analysis_epoch = incomplete.review_analysis_epoch
              AND settled.analysis_sequence
                = (event.payload->>'analysisSequence')::numeric
          )
      ) AS pending ON true
    ),
    coverage_summary AS (
      SELECT
        count(*)::int AS incomplete_property_count,
        COALESCE(sum(progress.pending_settlement_count), 0)::float8
          AS pending_settlement_count,
        CASE
          WHEN count(*) = 0 THEN NULL
          ELSE GREATEST(
            0,
            floor(
              EXTRACT(
                EPOCH FROM (
                  transaction_timestamp() - min(progress.last_progress_at)
                )
              ) * 1000
            )
          )::bigint
        END AS oldest_no_progress_age_ms
      FROM progress
    ),
    zero_snapshot_enrollments AS (
      SELECT eligible.eligible_review_count
      FROM ai_review_analysis_enrollments AS enrollment
      INNER JOIN merchant_ai_enablement AS auth
        ON auth.organization_id = enrollment.organization_id
       AND auth.property_id = enrollment.property_id
       AND auth.authorization_lineage_id = enrollment.authorization_lineage_id
       AND auth.state_version = enrollment.authorization_state_version
       AND auth.authorized_source_epoch = enrollment.source_epoch
       AND auth.review_analysis_epoch = enrollment.review_analysis_epoch
       AND auth.analysis_start_sequence = enrollment.analysis_start_sequence
       AND auth.state = 'enabled'
       AND 'review_analysis' = ANY(auth.capabilities)
      CROSS JOIN LATERAL (
        SELECT count(*)::bigint AS eligible_review_count
        FROM reviews AS review
        WHERE review.organization_id = enrollment.organization_id
          AND review.property_id = enrollment.property_id
          AND review.source_epoch = enrollment.source_epoch
          AND review.source_revision >= 1
          AND review.analysis_sequence <= enrollment.analysis_start_sequence
          AND review.text IS NOT NULL
          AND review.content_expires_at > transaction_timestamp()
          AND review.ai_source_byte_length
            <= ${MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1}
          AND (
            COALESCE(octet_length(review.text), 0)::bigint
            + COALESCE(octet_length(review.language_code), 0)::bigint
            + COALESCE(octet_length(review.reviewer_name), 0)::bigint
          ) <= ${MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1}
      ) AS eligible
      WHERE enrollment.state IN ('queued', 'running')
        AND enrollment.snapshot_revision_count = 0
        AND eligible.eligible_review_count > 0
    ),
    enrollment_summary AS (
      SELECT
        count(*)::int AS zero_snapshot_enrollment_count,
        COALESCE(sum(eligible_review_count), 0)::float8
          AS eligible_review_count_missed
      FROM zero_snapshot_enrollments
    )
    SELECT
      coverage_summary.incomplete_property_count,
      coverage_summary.pending_settlement_count,
      coverage_summary.oldest_no_progress_age_ms,
      enrollment_summary.zero_snapshot_enrollment_count,
      enrollment_summary.eligible_review_count_missed
    FROM coverage_summary
    CROSS JOIN enrollment_summary
  `)
  const row = result.rows[0] as
    | {
        incomplete_property_count?: unknown
        pending_settlement_count?: unknown
        oldest_no_progress_age_ms?: unknown
        zero_snapshot_enrollment_count?: unknown
        eligible_review_count_missed?: unknown
      }
    | undefined
  if (!row) throw new Error('Review Analysis health aggregate returned no row')

  const incompletePropertyCount = Number(row.incomplete_property_count)
  const pendingSettlementCount = Number(row.pending_settlement_count)
  const oldestNoProgressAgeMs =
    row.oldest_no_progress_age_ms == null ? null : Number(row.oldest_no_progress_age_ms)
  const zeroSnapshotEnrollmentCount = Number(row.zero_snapshot_enrollment_count)
  const eligibleReviewCountMissed = Number(row.eligible_review_count_missed)
  if (
    !Number.isSafeInteger(incompletePropertyCount) ||
    incompletePropertyCount < 0 ||
    !Number.isSafeInteger(pendingSettlementCount) ||
    pendingSettlementCount < 0 ||
    (oldestNoProgressAgeMs != null &&
      (!Number.isSafeInteger(oldestNoProgressAgeMs) || oldestNoProgressAgeMs < 0)) ||
    !Number.isSafeInteger(zeroSnapshotEnrollmentCount) ||
    zeroSnapshotEnrollmentCount < 0 ||
    !Number.isSafeInteger(eligibleReviewCountMissed) ||
    eligibleReviewCountMissed < 0 ||
    (incompletePropertyCount === 0) !== (oldestNoProgressAgeMs === null)
  ) {
    throw new Error('Review Analysis health aggregate returned an invalid reading')
  }
  return {
    monitorAvailable: true,
    incompletePropertyCount,
    pendingSettlementCount,
    oldestNoProgressAgeMs,
    zeroSnapshotEnrollmentCount,
    eligibleReviewCountMissed,
  }
}

export function createAlertAuxReader(deps: AlertAuxReaderDeps): AlertAuxReader {
  return {
    read: async () => {
      const [retentionFailedSubjects, betaFeedbackTriage, reviewAnalysis] =
        await Promise.all([
          readRetentionFailedSubjects(deps.db).catch((err: unknown) => {
            deps.logger.warn(
              { err },
              '[alert-aux] retention_runs read failed — empty fallback',
            )
            return [] as readonly string[]
          }),
          readBetaFeedbackTriage(deps.db).catch((err: unknown) => {
            deps.logger.warn(
              { err },
              '[alert-aux] beta-feedback triage read failed — unavailable fallback',
            )
            return {
              monitorAvailable: false,
              deliveredUnresolvedCount: 0,
              oldestDeliveredUnresolvedAgeMs: null,
            } as const
          }),
          readReviewAnalysisHealth(deps.db).catch((err: unknown) => {
            deps.logger.warn(
              { err },
              '[alert-aux] Review Analysis health read failed — unavailable fallback',
            )
            return {
              monitorAvailable: false,
              incompletePropertyCount: 0,
              pendingSettlementCount: 0,
              oldestNoProgressAgeMs: null,
              zeroSnapshotEnrollmentCount: 0,
              eligibleReviewCountMissed: 0,
            } as const
          }),
        ])

      return { retentionFailedSubjects, betaFeedbackTriage, reviewAnalysis }
    },
  }
}
