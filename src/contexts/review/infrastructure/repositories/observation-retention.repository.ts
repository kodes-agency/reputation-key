// Review — retention of `review_source_observations` (ADR 0055, note 2026-10-24 (b)).
//
// Two operations, both bounded and content-free in what they return:
//
// - The repeat prune removes the rows the old writer stored for a read that
//   found nothing new. Until 2026-10-24 every read wrote a full-text row, so a
//   review nobody touched held one copy of its text per pass: 3,400,389 of the
//   beta's 3,425,776 rows. A repeat is an `unchanged` row that is not the
//   Review's newest and whose previous applied row (the nearest earlier one that
//   is not `out_of_order_ignored`) has the same source epoch, material revision,
//   observation digest and content state. Every reader keeps its answer: the
//   newest row stays for the lifecycle inspection, the first row of each revision
//   is never `unchanged` (`selectRevisionBindingComparisons`), and the applied
//   row before any `material_change` keeps its digest, so its `source_updated_at`
//   and epoch (`listRestatedRevisions`).
// - The superseded-copy redaction blanks the provider content of a row that is
//   no longer the Review's newest once its 30-day clock has passed. That clock
//   is the last fetch that returned the content, and nothing will fetch a
//   superseded copy again, so ADR 0031's refresh-or-remove leaves only remove.
//   The row keeps its digests, comparison, revision and times of RepKey's own,
//   which is all the history readers use; it reads `source_expired`, the state
//   erasure writes. The newest row is the Review's current content and belongs
//   to the Review lifecycle, which this never touches.

import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { DEFAULT_MAX_BATCHES_PER_RUN } from '#/shared/db/retention/execute-retention-rule'
import { reviewId } from '#/shared/domain/ids'
import type {
  ObservationRepeatBatch,
  ObservationRepeatBatchInput,
  ObservationRetention,
  ObservationRetentionScope,
} from '../../application/ports/observation-retention.port'

/** Reviews read per repeat batch. Each holds ~277 rows on the beta today. */
export const MAX_REPEAT_BATCH_REVIEWS = 200
/** Rows redacted per superseded-copy batch. */
export const MAX_REDACTION_BATCH_ROWS = 500

type RepeatBatchRow = Readonly<{
  reviews: number
  observations: number
  repeats: number
  last: string | null
}>

function organizationCondition(column: SQL, scope: ObservationRetentionScope = {}) {
  return scope.organizationId === undefined
    ? sql`TRUE`
    : sql`${column} = ${scope.organizationId}`
}

function assertBatchSize(limit: number, max: number, what: string): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > max) {
    throw new TypeError(`${what} must be between 1 and ${String(max)}`)
  }
}

/** The batch of Reviews after the cursor and the repeats among their rows. */
function repeatCtes(input: ObservationRepeatBatchInput) {
  return sql`
    batch AS (
      SELECT id, organization_id, source_observation_sequence
      FROM reviews
      WHERE ${input.after === null ? sql`TRUE` : sql`id > ${input.after}::uuid`}
        AND ${organizationCondition(sql`organization_id`, input.scope)}
      ORDER BY id
      LIMIT ${input.limit}
    ),
    applied AS (
      SELECT o.review_id, o.observation_sequence, o.comparison_result,
             o.source_epoch, o.material_revision, o.observation_digest, o.content_state,
             batch.source_observation_sequence AS newest_sequence,
             lag(o.source_epoch) OVER history AS previous_epoch,
             lag(o.material_revision) OVER history AS previous_revision,
             lag(o.observation_digest) OVER history AS previous_digest,
             lag(o.content_state) OVER history AS previous_state
      FROM review_source_observations o
      JOIN batch ON batch.id = o.review_id AND batch.organization_id = o.organization_id
      WHERE o.comparison_result <> 'out_of_order_ignored'
      WINDOW history AS (PARTITION BY o.review_id ORDER BY o.observation_sequence)
    ),
    repeats AS (
      SELECT review_id, observation_sequence
      FROM applied
      WHERE comparison_result = 'unchanged'
        AND observation_sequence <> newest_sequence
        AND previous_epoch = source_epoch
        AND previous_revision = material_revision
        AND previous_digest = observation_digest
        AND previous_state = content_state
    )`
}

const batchSummary = sql`
  (SELECT count(*)::int FROM batch) AS reviews,
  (SELECT count(*)::int
     FROM review_source_observations o
     JOIN batch ON batch.id = o.review_id AND batch.organization_id = o.organization_id
  ) AS observations,
  (SELECT id::text FROM batch ORDER BY id DESC LIMIT 1) AS last`

function toRepeatBatch(row: RepeatBatchRow | undefined): ObservationRepeatBatch {
  return {
    reviews: row?.reviews ?? 0,
    observations: row?.observations ?? 0,
    repeats: row?.repeats ?? 0,
    last: row?.last == null ? null : reviewId(row.last),
  }
}

async function redactExpiredSupersededCopies(
  db: Database,
  limit: number,
  scope: ObservationRetentionScope = {},
): Promise<number> {
  assertBatchSize(limit, MAX_REDACTION_BATCH_ROWS, 'Redaction batch size')
  // The newest row is read from the Review inside the statement. A Review's
  // newest row only ever moves to a new row, so a row that is superseded here
  // stays superseded; a row that became superseded after the snapshot waits
  // for the next run. SKIP LOCKED leaves a row a writer holds to that run too.
  const result = await db.execute(sql`
    WITH due AS (
      SELECT copy.review_id, copy.observation_sequence
      FROM review_source_observations copy
      JOIN reviews review
        ON review.id = copy.review_id
       AND review.organization_id = copy.organization_id
      WHERE copy.content_state = 'active'
        AND copy.content_expires_at <= transaction_timestamp()
        AND copy.observation_sequence <> review.source_observation_sequence
        AND ${organizationCondition(sql`copy.organization_id`, scope)}
      ORDER BY copy.content_expires_at, copy.review_id, copy.observation_sequence
      LIMIT ${limit}
      FOR UPDATE OF copy SKIP LOCKED
    )
    UPDATE review_source_observations target
    SET rating = NULL,
        original_text = NULL,
        translated_text = NULL,
        language_code = NULL,
        reviewer_name = NULL,
        reviewer_profile_photo_url = NULL,
        reviewed_at = NULL,
        source_created_at = NULL,
        source_updated_at = NULL,
        content_state = 'source_expired',
        content_erased_at = transaction_timestamp(),
        updated_at = transaction_timestamp()
    FROM due
    WHERE target.review_id = due.review_id
      AND target.observation_sequence = due.observation_sequence
      AND target.content_state = 'active'
    RETURNING target.review_id
  `)
  return result.rowCount ?? 0
}

export const createObservationRetention = (db: Database): ObservationRetention => ({
  scanRepeats: async (input) => {
    assertBatchSize(input.limit, MAX_REPEAT_BATCH_REVIEWS, 'Repeat batch size')
    const result = await db.execute<RepeatBatchRow>(sql`
      WITH ${repeatCtes(input)}
      SELECT ${batchSummary}, (SELECT count(*)::int FROM repeats) AS repeats
    `)
    return toRepeatBatch(result.rows[0])
  },

  pruneRepeats: async (input) => {
    assertBatchSize(input.limit, MAX_REPEAT_BATCH_REVIEWS, 'Repeat batch size')
    const result = await db.execute<RepeatBatchRow>(sql`
      WITH ${repeatCtes(input)},
      deleted AS (
        DELETE FROM review_source_observations target
        USING repeats
        WHERE target.review_id = repeats.review_id
          AND target.observation_sequence = repeats.observation_sequence
          AND target.comparison_result = 'unchanged'
        RETURNING 1
      )
      SELECT ${batchSummary}, (SELECT count(*)::int FROM deleted) AS repeats
    `)
    return toRepeatBatch(result.rows[0])
  },

  redactExpiredSupersededCopies: ({ limit, scope }) =>
    redactExpiredSupersededCopies(db, limit, scope),

  sweepExpiredSupersededCopies: async ({
    batchSize,
    maxBatches = DEFAULT_MAX_BATCHES_PER_RUN,
    scope,
  }) => {
    let batches = 0
    let processed = 0
    for (;;) {
      const redacted = await redactExpiredSupersededCopies(db, batchSize, scope)
      if (redacted === 0) return { batches, processed, capped: false }
      batches += 1
      processed += redacted
      if (batches >= maxBatches) {
        return { batches, processed, capped: redacted === batchSize }
      }
    }
  },
})
