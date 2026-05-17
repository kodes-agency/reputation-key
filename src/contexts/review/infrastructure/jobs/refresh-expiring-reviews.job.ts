// Review context — BullMQ job handler for refreshing expiring reviews
// Finds reviews expiring within 5 days, enqueues sync jobs to re-fetch them.

import type { Job } from 'bullmq'
import type { ReviewRepository } from '../../application/ports/review.repository'
import type { ReviewQueuePort } from '../../application/ports/review-queue.port'
import { getLogger } from '#/shared/observability/logger'

type RefreshHandlerDeps = Readonly<{
  reviewRepo: ReviewRepository
  queue: ReviewQueuePort
  clock: () => Date
}>

export const createRefreshExpiringReviewsHandler = (deps: RefreshHandlerDeps) => {
  return async (_job: Job) => {
    const logger = getLogger()
    const fiveDaysFromNow = new Date(deps.clock().getTime() + 5 * 24 * 60 * 60 * 1000)

    const expiring = await deps.reviewRepo.findAllExpiringBefore(fiveDaysFromNow)

    // Group by (propertyId, connectionId, locationName, organizationId)
    const grouped = new Map<string, { propertyId: string; organizationId: string; connectionId: string; locationName: string }>()
    for (const review of expiring) {
      const connectionId = review.googleConnectionId
      if (!connectionId) continue

      const key = `${review.propertyId}:${connectionId}:${review.externalLocationId}`
      if (!grouped.has(key)) {
        // Branded IDs cast to string for serializable BullMQ job data.
        // Consumer (sync-property-reviews.job) re-brands via idGen constructors.
        grouped.set(key, {
          propertyId: review.propertyId as string,
          organizationId: review.organizationId as string,
          connectionId: connectionId as string,
          // externalLocationId stores the full GBP location name (e.g., "locations/12345/67890")
          // which is required by the reviews API for sync.
          locationName: review.externalLocationId,
        })
      }
    }

    let enqueued = 0
    for (const data of grouped.values()) {
      try {
        await deps.queue.addSyncJob(data)
        enqueued++
      } catch (err) {
        logger.warn({ err, propertyId: data.propertyId }, 'Failed to enqueue refresh job')
      }
    }

    logger.info(
      { expiringCount: expiring.length, propertiesRefreshed: enqueued },
      'Refresh expiring reviews completed',
    )
  }
}
