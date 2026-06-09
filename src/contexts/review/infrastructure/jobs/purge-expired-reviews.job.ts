// Review context — BullMQ job handler for purging expired reviews
// Deletes reviews that expired more than 3 days ago (grace period for failed syncs).
//
// ⚠️ CROSS-TENANT: This job intentionally scans ALL organizations in one pass.
// It uses findAllExpiredBeforeAcrossTenants() which has no tenant filter.
// This is safe because:
//   1. The job is system-level, triggered by a scheduler, not by any user action.
//   2. Each review's organizationId is used when calling deleteById (tenant-scoped delete).
//   3. No user-supplied input controls which orgs are processed.

import type { Job } from 'bullmq'

export const JOB_NAME = 'purge-expired-reviews' as const
import type { ReviewRepository } from '../../application/ports/review.repository'
import type { EventBus } from '#/shared/events/event-bus'
import { reviewExpired } from '../../domain/events'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

type PurgeHandlerDeps = Readonly<{
  reviewRepo: ReviewRepository
  events: EventBus
  clock: () => Date
}>

export const createPurgeExpiredReviewsHandler = (deps: PurgeHandlerDeps) => {
  return async (_job: Job) => {
    return trace('job.purgeExpiredReviews', async () => {
      const logger = getLogger()
      const threeDaysAgo = new Date(deps.clock().getTime() - 3 * 24 * 60 * 60 * 1000)

      // Cross-tenant scan: intentionally fetches across all orgs (system-level job).
      // Each iteration below is tenant-scoped via review.organizationId.
      const expired =
        await deps.reviewRepo.findAllExpiredBeforeAcrossTenants(threeDaysAgo)
      const now = deps.clock()

      let purged = 0
      for (const review of expired) {
        try {
          // Emit event BEFORE delete so downstream handlers can still access review data
          await deps.events.emit(
            reviewExpired({
              reviewId: review.id,
              propertyId: review.propertyId,
              organizationId: review.organizationId,
              occurredAt: now,
            }),
          )
          // deleteById is tenant-scoped — uses review.organizationId
          await deps.reviewRepo.deleteById(review.id, review.organizationId)
          purged++
        } catch (err) {
          logger.warn({ err, reviewId: review.id }, 'Failed to purge expired review')
        }
      }

      logger.info(
        { expiredCount: expired.length, purged },
        'Purge expired reviews completed',
      )
    })
  }
}
