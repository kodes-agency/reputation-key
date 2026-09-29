import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import {
  MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1,
  MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1,
} from '#/shared/ai-review-source-contract'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { aiReviewAnalysisBackfillRequested } from '../../domain/events'
import {
  AI_REVIEW_ANALYSIS_MAX_REOPENS,
  AI_REVIEW_ANALYSIS_REOPEN_CODES,
} from '../../domain/review-analysis-reopen'
import type { AiReviewAnalysisReopenPort } from '../../application/ports/ai-review-analysis-reopen.port'

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]
type Row = Readonly<Record<string, unknown>>

/**
 * A review whose current text the analysis may read: present, unexpired and
 * within the source bounds. Shared with the enrollment snapshot, so the
 * reviews an enrollment counts are the reviews that can be reopened.
 * Expects the `review` alias.
 */
export const ANALYSABLE_REVIEW_SQL = sql`
  review.text IS NOT NULL
  AND review.content_expires_at > transaction_timestamp()
  AND review.ai_source_byte_length <= ${MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1}
  AND (
    COALESCE(octet_length(review.text), 0)::bigint
    + COALESCE(octet_length(review.language_code), 0)::bigint
    + COALESCE(octet_length(review.reviewer_name), 0)::bigint
  ) <= ${MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1}
`

const REOPEN_CODES_SQL = sql.join(
  AI_REVIEW_ANALYSIS_REOPEN_CODES.map((code) => sql`${code}`),
  sql`, `,
)

/**
 * The analysis operation for the review's current sequence, in the review's
 * own tenant (aliases `review`, `operation`).
 */
function currentOperationPredicate(): SQL {
  return sql`
    operation.organization_id = review.organization_id
    AND operation.property_id = review.property_id
    AND operation.review_id = review.id
    AND operation.command = 'analysis'
    AND operation.source_epoch = review.source_epoch
    AND operation.analysis_sequence = review.analysis_sequence
  `
}

/**
 * The operation gave up for a reason that says nothing about the review, on
 * text that can still be analysed. `reopens` compares the revision's earlier
 * give-ups with the reopen budget: `left` while it may be reopened again,
 * `spent` once it has used every reopen.
 */
function abandonedOperationSql(reopens: 'left' | 'spent'): SQL {
  const compare = reopens === 'left' ? sql`<=` : sql`>`
  return sql`
    operation.state = 'failed'
    AND operation.failure_code IN (${REOPEN_CODES_SQL})
    AND ${ANALYSABLE_REVIEW_SQL}
    AND (
      SELECT count(*)
      FROM ai_operations AS prior
      WHERE prior.organization_id = review.organization_id
        AND prior.property_id = review.property_id
        AND prior.review_id = review.id
        AND prior.command = 'analysis'
        AND prior.source_epoch = review.source_epoch
        AND prior.source_revision = review.source_revision
        AND prior.state = 'failed'
        AND prior.failure_code IN (${REOPEN_CODES_SQL})
    ) ${compare} ${AI_REVIEW_ANALYSIS_MAX_REOPENS}
  `
}

/** The review's current sequence has settled in the aggregate ledger. */
function currentSequenceSettledSql(reviewAnalysisEpoch: SQL): SQL {
  return sql`EXISTS (
    SELECT 1
    FROM ai_property_aggregate_settlements AS settlement
    WHERE settlement.organization_id = review.organization_id
      AND settlement.property_id = review.property_id
      AND settlement.review_id = review.id
      AND settlement.source_epoch = review.source_epoch
      AND settlement.review_analysis_epoch = ${reviewAnalysisEpoch}
      AND settlement.analysis_sequence = review.analysis_sequence
  )`
}

/** The review's current sequence has a ready analysis. */
function currentSequenceAnalysedSql(reviewAnalysisEpoch: SQL): SQL {
  return sql`EXISTS (
    SELECT 1
    FROM ai_review_analyses AS analysis
    WHERE analysis.organization_id = review.organization_id
      AND analysis.property_id = review.property_id
      AND analysis.review_id = review.id
      AND analysis.source_epoch = review.source_epoch
      AND analysis.review_analysis_epoch = ${reviewAnalysisEpoch}
      AND analysis.analysis_sequence = review.analysis_sequence
      AND analysis.status = 'ready'
  )`
}

/**
 * Whether a review still owes its enrollment an analysis (alias `review`):
 * its current sequence has not settled, or it settled without a result while
 * its operation is still open (the reaper will close it) or was abandoned with
 * reopens left. A review settled for a reason about the review itself — the
 * redactor, its language, its source — owes nothing and does not hold the
 * enrollment back.
 */
function reviewAnalysisOutstandingSql(reviewAnalysisEpoch: number): SQL {
  const epoch = sql`${reviewAnalysisEpoch}`
  return sql`(
    NOT ${currentSequenceSettledSql(epoch)}
    OR (
      NOT ${currentSequenceAnalysedSql(epoch)}
      AND EXISTS (
        SELECT 1
        FROM ai_operations AS operation
        WHERE ${currentOperationPredicate()}
          AND (
            operation.state IN ('pending', 'executing')
            OR (${abandonedOperationSql('left')})
          )
      )
    )
  )`
}

/**
 * Whether any review a first-enablement enrollment replayed still owes it an
 * analysis. Its replayed events carry the enrollment id as correlation; a
 * review reopened since carries a newer, still-open sequence, so it keeps the
 * enrollment waiting until that settles too.
 */
export async function enrollmentOwesAnalysis(
  tx: Tx,
  input: Readonly<{
    organizationId: string
    propertyId: string
    enrollmentId: string
    fence: Readonly<{ sourceEpoch: number; reviewAnalysisEpoch: number }>
  }>,
): Promise<boolean> {
  const result = await tx.execute(sql`
    SELECT EXISTS (
      SELECT 1
      FROM outbox_events AS event
      INNER JOIN reviews AS review
        ON review.organization_id = event.organization_id
       AND review.property_id = ${input.propertyId}::uuid
       AND review.id::text = event.payload->>'reviewId'
       AND review.source_epoch = ${input.fence.sourceEpoch}
      WHERE event.organization_id = ${input.organizationId}
        AND event.payload->>'correlationId' = ${input.enrollmentId}
        AND event.event_type = 'ai.review_analysis.backfill_requested'
        AND ${reviewAnalysisOutstandingSql(input.fence.reviewAnalysisEpoch)}
    ) AS outstanding
  `)
  return (result.rows[0] as Row | undefined)?.outstanding === true
}

/**
 * Abandoned analyses of Properties whose current authorization includes Review
 * Analysis, in the lineage that authorization fences (alias `review`).
 */
function abandonedInCurrentLineageSql(reopens: 'left' | 'spent'): SQL {
  const epoch = sql`enablement.review_analysis_epoch`
  return sql`
    FROM reviews AS review
    INNER JOIN merchant_ai_enablement AS enablement
      ON enablement.organization_id = review.organization_id
     AND enablement.property_id = review.property_id
    INNER JOIN ai_operations AS operation
      ON ${currentOperationPredicate()}
    WHERE enablement.state = 'enabled'
      AND 'review_analysis' = ANY(enablement.capabilities)
      AND review.source_epoch = enablement.authorized_source_epoch
      AND review.analysis_sequence > enablement.analysis_start_sequence
      AND ${abandonedOperationSql(reopens)}
      AND ${currentSequenceSettledSql(epoch)}
      AND NOT ${currentSequenceAnalysedSql(epoch)}
      AND NOT EXISTS (
        SELECT 1
        FROM ai_review_analysis_backlog AS queued
        WHERE queued.organization_id = review.organization_id
          AND queued.property_id = review.property_id
          AND queued.review_id = review.id
      )
  `
}

function safeInteger(value: unknown, field: string, minimum = 0): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`Review Analysis reopen read an invalid ${field}`)
  }
  return parsed
}

type Scope = Readonly<{ organizationId: string; propertyId: string }>

/**
 * Reopen one Property's abandoned reviews in one transaction. The Property row
 * is locked first and its reviews second, the order Review observation writes
 * take, and the candidates are re-selected under those locks: a review that
 * moved on since the scan is not reopened, and no sequence is allocated for it.
 */
async function reopenProperty(
  tx: Tx,
  scope: Scope,
  limit: number,
  occurredAt: Date,
): Promise<number> {
  await tx.execute(sql`
    SELECT 1 FROM properties
    WHERE organization_id = ${scope.organizationId}
      AND id = ${scope.propertyId}::uuid
    FOR UPDATE
  `)
  const candidates = await tx.execute(sql`
    SELECT review.id, review.source_epoch, review.source_revision,
           review.analysis_sequence, operation.id AS operation_id
    ${abandonedInCurrentLineageSql('left')}
      AND review.organization_id = ${scope.organizationId}
      AND review.property_id = ${scope.propertyId}::uuid
    ORDER BY operation.updated_at, operation.id
    LIMIT ${limit}
    FOR UPDATE OF review
  `)
  for (const raw of candidates.rows) {
    const candidate = raw as Row
    const sourceEpoch = safeInteger(candidate.source_epoch, 'source epoch')
    const sourceRevision = safeInteger(candidate.source_revision, 'source revision', 1)
    const allocated = await tx.execute(sql`
      SELECT lock_review_ai_analysis_head_v1(
        ${scope.organizationId}, ${scope.propertyId}::uuid, ${sourceEpoch}
      ) AS sequence
    `)
    const sequence = safeInteger(
      (allocated.rows[0] as Row | undefined)?.sequence,
      'allocated analysis sequence',
      1,
    )
    const updated = await tx.execute(sql`
      UPDATE reviews
      SET analysis_sequence = ${sequence}
      WHERE organization_id = ${scope.organizationId}
        AND property_id = ${scope.propertyId}::uuid
        AND id = ${String(candidate.id)}::uuid
        AND source_epoch = ${sourceEpoch}
        AND source_revision = ${sourceRevision}
        AND analysis_sequence = ${safeInteger(candidate.analysis_sequence, 'analysis sequence', 1)}
    `)
    if (updated.rowCount !== 1) {
      // Locked above, so this cannot move; roll the allocation back if it did.
      throw new Error('Review Analysis reopen candidate changed while locked')
    }
    await insertOutboxRow(
      tx,
      aiReviewAnalysisBackfillRequested({
        organizationId: organizationId(scope.organizationId),
        propertyId: propertyId(scope.propertyId),
        reviewId: reviewId(String(candidate.id)),
        sourceEpoch,
        sourceRevision,
        analysisSequence: sequence,
        occurredAt,
        // The abandoned operation, so the new attempt is traceable to it.
        correlationId: String(candidate.operation_id),
      }),
      { recordedAt: occurredAt },
    )
  }
  return candidates.rows.length
}

export const createAiReviewAnalysisReopenAdapter = (
  db: Database,
): AiReviewAnalysisReopenPort =>
  Object.freeze({
    async reopenAbandoned(input) {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1) {
        throw new Error('Review Analysis reopen limit is invalid')
      }
      const properties = await db.execute(sql`
        SELECT review.organization_id, review.property_id
        ${abandonedInCurrentLineageSql('left')}
        GROUP BY review.organization_id, review.property_id
        ORDER BY min(operation.updated_at)
        LIMIT ${input.limit}
      `)
      let reopened = 0
      for (const raw of properties.rows) {
        if (reopened >= input.limit) break
        const row = raw as Row
        const scope = {
          organizationId: String(row.organization_id),
          propertyId: String(row.property_id),
        }
        reopened += await db.transaction((tx) =>
          reopenProperty(tx, scope, input.limit - reopened, input.occurredAt),
        )
      }
      const spent = await db.execute(sql`
        SELECT count(*) AS left_unanalysed
        ${abandonedInCurrentLineageSql('spent')}
      `)
      return {
        reopened,
        leftUnanalysed: safeInteger(
          (spent.rows[0] as Row | undefined)?.left_unanalysed ?? 0,
          'unanalysed count',
        ),
      }
    },
  })
