// Review context — BullMQ job handler for refreshing expiring reviews
// Finds reviews in the policy refresh-due window (contentExpiresAt within
// the lead before hard expiry) and enqueues sync jobs to re-fetch them.
//
// BQR-3.2 / ADR 0031: uses fetch-based contentExpiresAt + SourceContentPolicy,
// not the legacy publication-based expiresAt clock.

import type { Job } from 'bullmq'

export const JOB_NAME = 'refresh-expiring-reviews' as const
import type { ReviewRepository } from '../../application/ports/review.repository'
import type { ReviewQueuePort } from '../../application/ports/review-queue.port'
import {
  classifyReviewsForRefresh,
  contentRefreshDueThreshold,
} from '../../application/source-content-lifecycle'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

type RefreshHandlerDeps = Readonly<{
  reviewRepo: ReviewRepository
  queue: ReviewQueuePort
  clock: () => Date
}>

export const createRefreshExpiringReviewsHandler = (deps: RefreshHandlerDeps) => {
  return async (_job: Job) => {
    return trace('job.refreshExpiringReviews', async () => {
      const logger = getLogger()
      const now = deps.clock()
      const threshold = contentRefreshDueThreshold(now)

      const candidates =
        await deps.reviewRepo.findAllExpiringBeforeAcrossTenants(threshold)

      // Classify with the same pure rules as unit tests: only refresh_due
      // (not already expired — those are the purge job's responsibility).
      const { refreshDue } = classifyReviewsForRefresh(
        candidates.map((r) => ({
          id: r.id as string,
          lastFetchedAt: r.lastFetchedAt,
          contentExpiresAt: r.contentExpiresAt,
        })),
        now,
      )
      const dueIds = new Set(refreshDue)
      const expiring = candidates.filter((r) => dueIds.has(r.id as string))

      // Group by (propertyId, connectionId, locationName, organizationId)
      const grouped = new Map<
        string,
        {
          propertyId: string
          organizationId: string
          connectionId: string
          locationName: string
        }
      >()
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
          logger.warn(
            { err, propertyId: data.propertyId },
            'Failed to enqueue refresh job',
          )
        }
      }

      logger.info(
        {
          candidateCount: candidates.length,
          refreshDueCount: expiring.length,
          propertiesRefreshed: enqueued,
        },
        'Refresh expiring reviews completed',
      )
    })
  }
}
