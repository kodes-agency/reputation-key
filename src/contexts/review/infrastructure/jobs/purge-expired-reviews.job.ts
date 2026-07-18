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
// ⚠️ CROSS-TENANT: This job intentionally scans ALL organizations in one pass.
// It uses findAllExpiredBeforeAcrossTenants() which has no tenant filter.
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

type PurgeHandlerDeps = Readonly<{
  reviewRepo: ReviewRepository
  /** BQC-3.3: atomic review delete + review.expired outbox write per review. */
  commandStore: ReplyCommandStore
  clock: () => Date
  db?: Database
}>

export const createPurgeExpiredReviewsHandler = (deps: PurgeHandlerDeps) => {
  return async (_job: Job) => {
    return trace('job.purgeExpiredReviews', async () => {
      const logger = getLogger()
      const now = deps.clock()

      // Cross-tenant scan: intentionally fetches across all orgs (system-level job).
      // Each iteration below is tenant-scoped via review.organizationId.
      // Threshold is `now` — exclusive boundary means contentExpiresAt < now.
      const expired = await deps.reviewRepo.findAllExpiredBeforeAcrossTenants(now)

      // BQC-1.6: content-free deletion evidence (counts + outcome only).
      const evidenceId = deps.db
        ? await openRetentionRun(deps.db, 'reviews.purge', expired.length || 1, now)
        : null

      let purged = 0
      let failed = 0
      for (const review of expired) {
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
          logger.warn({ err, reviewId: review.id }, 'Failed to purge expired review')
        }
      }

      if (evidenceId) {
        await closeRetentionRun(deps.db!, evidenceId, {
          finishedAt: deps.clock(),
          batches: 1,
          rowsDeleted: purged,
          outcome: failed > 0 ? 'failed' : 'completed',
          errorCode: failed > 0 ? `${failed} purge failure(s)` : undefined,
        }).catch(() => {})
      }

      logger.info(
        { expiredCount: expired.length, purged, failed },
        'Purge expired reviews completed',
      )
    })
  }
}
