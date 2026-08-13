// Review context — BullMQ job handler for purging expired reviews
// Deletes reviews whose contentExpiresAt has passed (fetch-based clock).
//
// BQR-3.2 / ADR 0031: no post-expiry grace period. Raw content must not be
// served after the policy TTL from the last successful Google fetch.
//
// BQC-3.3: delete + review.expired outbox fact commit in ONE transaction per
// review (ReplyCommandStore.purgeExpiredReview). A review whose purge tx
// fails stays in place — neither deleted nor fact-recorded — and is retried
// on the next sweep.
//
// BQC-8.3: keyset-bounded batch loop, replacing the one-shot 5,000-row scan
// (findAllExpiredBeforeAcrossTenants). Batches are ordered (contentExpiresAt,
// id) via findExpiredBatchBeforeAcrossTenants:
//   - one run drains at most maxBatches × batchSize rows (100 × 500 = 50k —
//     the BQC-3.7 per-run drain bound) and reports 'budget_exhausted' when it
//     stops at the cap with rows (likely) remaining; the vocabulary mirrors
//     the refresh sweep's review_refresh_runs.status enum. The scheduler's
//     next run (or an operator/drill re-drive) continues the drain.
//   - no cross-run cursor table: every fresh run starts cursor-less and walks
//     oldest-first, which re-covers anything a previous run left behind —
//     expired rows never un-expire, so re-scanning from the beginning is
//     idempotent and cannot skip live work.
//   - a failed review does NOT hold the cursor (the batch loop cannot
//     livelock on a permanently failing row); it is retried on the next
//     sweep.
//   - evidence stays one retention_runs row per run (subject 'reviews.purge')
//     with batch/row totals; capped runs close 'completed' per the BQC-3.7
//     retention-sweep convention — the cap is visible in the returned
//     PurgeRunResult.status and the completion log.
//
// ⚠️ CROSS-TENANT: This job intentionally scans ALL organizations in one pass.
// It uses findExpiredBatchBeforeAcrossTenants() which has no tenant filter.
// This is safe because:
//   1. The job is system-level, triggered by a scheduler, not by any user action.
//   2. Each review's organizationId scopes the delete (tenant-scoped delete).
//   3. No user-supplied input controls which orgs are processed.

import type { Job } from 'bullmq'

export const JOB_NAME = 'purge-expired-reviews' as const
import type { ReviewRepository } from '../../application/ports/review.repository'
import type { ReplyCommandStore } from '../../application/ports/reply-command-store.port'
import type { Database } from '#/shared/db'
import { reviewExpired } from '../../domain/events'
import { closeRetentionRun, openRetentionRun } from '#/shared/db/retention/evidence'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

/** BQC-8.3: per-run drain bound (100 batches × 500 rows = 50k rows max). */
export const DEFAULT_BATCH_SIZE = 500
export const DEFAULT_MAX_BATCHES = 100

/** Run summary — the drill/operator signal the BullMQ path cannot return. */
export type PurgeRunResult = Readonly<{
  /** 'budget_exhausted' when the run stopped at the batch cap with rows (likely) remaining. */
  status: 'completed' | 'budget_exhausted'
  batches: number
  purged: number
  failed: number
  /** Rows seen per batch — per-batch progression evidence for scale drills. */
  batchRows: ReadonlyArray<number>
}>

type PurgeHandlerDeps = Readonly<{
  reviewRepo: ReviewRepository
  /** BQC-3.3: atomic review delete + review.expired outbox write per review. */
  commandStore: ReplyCommandStore
  clock: () => Date
  db?: Database
  batchSize?: number
  maxBatches?: number
}>

export const createPurgeExpiredReviewsHandler = (deps: PurgeHandlerDeps) => {
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE
  const maxBatches = deps.maxBatches ?? DEFAULT_MAX_BATCHES

  return async (_job: Job): Promise<PurgeRunResult> => {
    return trace('job.purgeExpiredReviews', async () => {
      const logger = getLogger()
      // Single clock reading pins the threshold for the whole run — rows that
      // expire mid-run are the next sweep's work, keeping the walk bounded.
      const now = deps.clock()

      // BQC-1.6: content-free deletion evidence (counts + outcome only).
      const evidenceId = deps.db
        ? await openRetentionRun(deps.db, 'reviews.purge', batchSize, now)
        : null

      let cursor: Readonly<{ contentExpiresAt: Date; id: string }> | null = null
      let batches = 0
      let purged = 0
      let failed = 0
      const batchRows: number[] = []
      let exhausted = false

      for (;;) {
        // Cross-tenant scan: intentionally fetches across all orgs
        // (system-level job). Each purge below is tenant-scoped via
        // review.organizationId. Threshold is `now` — exclusive boundary
        // means contentExpiresAt < now.
        const batch = await deps.reviewRepo.findExpiredBatchBeforeAcrossTenants(
          now,
          cursor,
          batchSize,
        )
        if (batch.length === 0) break
        batches++
        batchRows.push(batch.length)

        for (const review of batch) {
          try {
            // Atomic per-review purge: the review row and its review.expired
            // outbox fact commit together. On failure the review is left in
            // place (no partial state) and retried on the next sweep.
            await deps.commandStore.purgeExpiredReview(
              review.id,
              reviewExpired({
                reviewId: review.id,
                propertyId: review.propertyId,
                organizationId: review.organizationId,
                occurredAt: now,
              }),
            )
            purged++
          } catch (err) {
            failed++
            logger.warn({ err }, 'Failed to purge expired review')
          }
        }

        // Advance past the whole batch — including any failed rows (they are
        // retried on the next sweep's fresh walk). Holding the cursor on a
        // failure would livelock the loop on the same row.
        const last = batch[batch.length - 1]!
        cursor = {
          contentExpiresAt: last.contentExpiresAt as Date,
          id: last.id as string,
        }

        if (batches >= maxBatches) {
          // BQC-3.7 convention: a full final batch implies more rows remain;
          // a partial one means the drain happened to finish exactly at the cap.
          exhausted = batch.length === batchSize
          break
        }
      }

      if (evidenceId) {
        await closeRetentionRun(deps.db!, evidenceId, {
          finishedAt: deps.clock(),
          batches,
          rowsDeleted: purged,
          outcome: failed > 0 ? 'failed' : 'completed',
          errorCode: failed > 0 ? `${failed} purge failure(s)` : undefined,
        }).catch(() => {})
      }

      logger.info(
        { purged, failed, batches, status: exhausted ? 'budget_exhausted' : 'completed' },
        exhausted
          ? 'Purge expired reviews reached the per-run batch cap — remaining rows continue next run'
          : 'Purge expired reviews completed',
      )

      return {
        status: exhausted ? 'budget_exhausted' : 'completed',
        batches,
        purged,
        failed,
        batchRows,
      }
    })
  }
}
