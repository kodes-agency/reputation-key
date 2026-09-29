import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { aiReviewAnalysisBackfillRequested } from '../../domain/events'
import type { ReviewAnalysisEnrollmentFence } from '../../application/ports/ai-review-analysis-enrollment.port'
import { ANALYSABLE_REVIEW_SQL } from './ai-review-analysis-reopen.adapter'
import { lockReviewAnalysisPropertyFence } from './review-analysis-property-fence'

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]
type Row = Readonly<Record<string, unknown>>
type Scope = Readonly<{ organizationId: string; propertyId: string }>

/** Enrollment states a reconcile can move into a replay. */
const REPLAYABLE_STATES = new Set(['queued', 'awaiting_assisted_approval'])

function positiveInteger(value: unknown, field: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Review Analysis enrollment read an invalid ${field}`)
  }
  return parsed
}

/**
 * The reviews an enrollment snapshots and replays: current, unanalysed since
 * the authorization started, and analysable. Expects the `review` alias.
 */
export function eligibleReviewsSql(
  input: Scope & Readonly<{ sourceEpoch: number; analysisStartSequence: number }>,
) {
  return sql`
    FROM reviews AS review
    WHERE review.organization_id = ${input.organizationId}
      AND review.property_id = ${input.propertyId}::uuid
      AND review.source_epoch = ${input.sourceEpoch}
      AND review.source_revision >= 1
      AND review.analysis_sequence <= ${input.analysisStartSequence}
      AND ${ANALYSABLE_REVIEW_SQL}
  `
}

/**
 * Take the Property fence before the enrollment row when this reconcile may
 * replay. The replay locks its candidate reviews and allocates their sequences
 * under the fence, and every Review writer and authorization change locks the
 * Property first. Locking the enrollment and reviews first deadlocked an
 * import running while Review Analysis was being enabled (closed beta,
 * 2026-09-29).
 *
 * The read is unlocked: an enrollment's Property never changes, and a row
 * already running or terminal never replays again, so it does not queue behind
 * an import for a fence it will not use.
 */
export async function lockPropertyBeforeReplay(
  tx: Tx,
  input: Readonly<{ enrollmentId: string; organizationId: string }>,
): Promise<void> {
  const peeked = await tx.execute(sql`
    SELECT property_id, state FROM ai_review_analysis_enrollments
    WHERE id = ${input.enrollmentId}::uuid
      AND organization_id = ${input.organizationId}
  `)
  const row = peeked.rows[0] as Row | undefined
  if (row === undefined || !REPLAYABLE_STATES.has(String(row.state))) return
  await lockReviewAnalysisPropertyFence(tx, {
    organizationId: input.organizationId,
    propertyId: String(row.property_id),
  })
}

/**
 * Pin every candidate review to a fresh analysis sequence and request its
 * backfill, correlated to the enrollment. Returns the number replayed. The
 * fence is taken again first, a no-op once `lockPropertyBeforeReplay` holds it,
 * so candidates are never locked ahead of the Property.
 */
export async function replayEnrollmentCandidates(
  tx: Tx,
  input: Readonly<{
    scope: Scope
    fence: ReviewAnalysisEnrollmentFence
    enrollmentId: string
    occurredAt: Date
  }>,
): Promise<number> {
  const { scope, fence } = input
  await lockReviewAnalysisPropertyFence(tx, scope)
  const candidates = await tx.execute(sql`
    SELECT review.id, review.source_revision
    ${eligibleReviewsSql({
      ...scope,
      sourceEpoch: fence.sourceEpoch,
      analysisStartSequence: fence.analysisStartSequence,
    })}
    ORDER BY review.id
    FOR UPDATE
  `)
  for (const raw of candidates.rows) {
    const candidate = raw as Row
    const allocated = await tx.execute(sql`
      SELECT lock_review_ai_analysis_head_v1(
        ${scope.organizationId},
        ${scope.propertyId}::uuid,
        ${fence.sourceEpoch}
      ) AS sequence
    `)
    const sequence = positiveInteger(
      (allocated.rows[0] as Row | undefined)?.sequence,
      'allocated analysis sequence',
    )
    const candidateId = String(candidate.id)
    const sourceRevision = positiveInteger(candidate.source_revision, 'source revision')
    const updated = await tx.execute(sql`
      UPDATE reviews
      SET analysis_sequence = ${sequence}
      WHERE organization_id = ${scope.organizationId}
        AND property_id = ${scope.propertyId}::uuid
        AND id = ${candidateId}::uuid
        AND source_epoch = ${fence.sourceEpoch}
        AND source_revision = ${sourceRevision}
        AND analysis_sequence <= ${fence.analysisStartSequence}
    `)
    if (updated.rowCount !== 1) {
      throw new Error('Review Analysis enrollment candidate changed while locked')
    }
    await insertOutboxRow(
      tx,
      aiReviewAnalysisBackfillRequested({
        organizationId: organizationId(scope.organizationId),
        propertyId: propertyId(scope.propertyId),
        reviewId: reviewId(candidateId),
        sourceEpoch: fence.sourceEpoch,
        sourceRevision,
        analysisSequence: sequence,
        occurredAt: input.occurredAt,
        correlationId: input.enrollmentId,
      }),
      { recordedAt: input.occurredAt },
    )
  }
  return candidates.rows.length
}
