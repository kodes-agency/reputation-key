import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { aiReviewAnalysisBackfillRequested } from '../domain/events'
import type { ReviewAnalysisEnrollmentFence } from './contracts'
import { ANALYSABLE_REVIEW_SQL } from './reopen-store.server'
import { lockReviewAnalysisPropertyFence } from '../infrastructure/adapters/review-analysis-property-fence'

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]
type Row = Readonly<Record<string, unknown>>
type Scope = Readonly<{ organizationId: string; propertyId: string }>

/** Enrollment states a reconcile can move into a replay. */
const REPLAYABLE_STATES = new Set(['queued', 'running', 'awaiting_assisted_approval'])

export const AI_REVIEW_ANALYSIS_REPLAY_PAGE_SIZE = 100

function integer(value: unknown, field: string, minimum: number): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < minimum) {
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

/** Count and digest of the eligible revision set an enrollment pins. */
export async function eligibleRevisionSnapshot(
  tx: Tx,
  input: Scope &
    Readonly<{
      sourceEpoch: number
      analysisStartSequence: number
      enrollmentId?: string
    }>,
): Promise<{ count: number; digest: string }> {
  // Sequence allocation removes a candidate from the remaining set. Include
  // committed pages in the snapshot so restarting never loses their evidence.
  const pinned =
    input.enrollmentId === undefined
      ? sql``
      : sql`
    UNION
    SELECT event.payload->>'reviewId' AS review_id,
           (event.payload->>'sourceRevision')::bigint AS source_revision
    FROM outbox_events AS event
    WHERE event.organization_id = ${input.organizationId}
      AND event.property_id = ${input.propertyId}
      AND event.payload->>'correlationId' = ${input.enrollmentId}
      AND (event.payload->>'sourceEpoch')::bigint = ${input.sourceEpoch}
      AND event.event_type = 'ai.review_analysis.backfill_requested'
  `
  const result = await tx.execute(sql`
    SELECT count(*)::bigint AS count,
           encode(
             sha256(
               convert_to(
                 COALESCE(
                   string_agg(
                     population.review_id || ':' || population.source_revision::text,
                     ',' ORDER BY population.review_id
                   ),
                   ''
                 ),
                 'UTF8'
               )
             ),
             'hex'
           ) AS digest
    FROM (
      SELECT review.id::text AS review_id, review.source_revision
      ${eligibleReviewsSql(input)}
      ${pinned}
    ) AS population
  `)
  const row = result.rows[0] as Row | undefined
  if (!row) throw new Error('Review Analysis enrollment snapshot returned no row')
  return { count: integer(row.count, 'snapshot count', 0), digest: String(row.digest) }
}

/**
 * Take the Property fence before the enrollment row and candidate reviews,
 * matching Review writers and authorization changes.
 *
 * The read is unlocked: an enrollment's Property never changes, and a row
 * terminal never replays again, so it needs no Property fence.
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
 * Pin one page to fresh sequences and request its backfill. The start-sequence
 * predicate is the durable cursor: committed reviews cannot be selected again.
 * Returns the number replayed. The
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
    LIMIT ${AI_REVIEW_ANALYSIS_REPLAY_PAGE_SIZE}
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
    const sequence = integer(
      (allocated.rows[0] as Row | undefined)?.sequence,
      'allocated analysis sequence',
      1,
    )
    const candidateId = String(candidate.id)
    const sourceRevision = integer(candidate.source_revision, 'source revision', 1)
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
