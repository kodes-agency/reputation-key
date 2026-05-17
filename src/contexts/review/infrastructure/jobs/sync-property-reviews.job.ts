// Review context — BullMQ job handler for syncing property reviews
// Per architecture: job handlers live in context/infrastructure/jobs/.

import type { Job } from 'bullmq'
import type { SyncPropertyReviewsJobData } from '../../application/ports/review-queue.port'
import type { ReviewRepository } from '../../application/ports/review.repository'
import type { ReplyRepository } from '../../application/ports/reply.repository'
import type { GoogleReviewApiPort } from '../../application/ports/google-review-api.port'
import type { EventBus } from '#/shared/events/event-bus'
import { syncReviews } from '../../application/use-cases/sync-reviews'
import { reviewId, propertyId, organizationId, googleConnectionId, replyId } from '#/shared/domain/ids'
import { getLogger } from '#/shared/observability/logger'

type SyncHandlerDeps = Readonly<{
  reviewRepo: ReviewRepository
  replyRepo: ReplyRepository
  googleReviewApi: GoogleReviewApiPort
  events: EventBus
  clock: () => Date
}>

export const createSyncPropertyReviewsHandler = (deps: SyncHandlerDeps) => {
  const sync = syncReviews({
    reviewRepo: deps.reviewRepo,
    replyRepo: deps.replyRepo,
    googleReviewApi: deps.googleReviewApi,
    events: deps.events,
    clock: deps.clock,
    idGen: () => reviewId(crypto.randomUUID()),
    replyIdGen: () => replyId(crypto.randomUUID()),
  })

  return async (job: Job<SyncPropertyReviewsJobData>) => {
    const logger = getLogger()
    logger.info({ jobId: job.id, propertyId: job.data.propertyId }, 'Syncing property reviews')

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    for (const id of [job.data.propertyId, job.data.organizationId, job.data.connectionId]) {
      if (!UUID_RE.test(id)) {
        logger.error({ jobData: job.data }, 'Invalid UUID in job data, skipping')
        return
      }
    }

    try {
      const result = await sync({
        propertyId: propertyId(job.data.propertyId),
        organizationId: organizationId(job.data.organizationId),
        connectionId: googleConnectionId(job.data.connectionId),
        locationName: job.data.locationName,
      })

      if (result.isErr()) {
        const e = result.error
        logger.warn(
          { err: e, jobId: job.id, propertyId: job.data.propertyId, context: e.context },
          'Property reviews sync completed with errors',
        )
        // Don't throw — partial sync still persisted data.
        // BullMQ will not retry since this is not a thrown error.
        return
      }

      const ok = result.value
      logger.info(
        {
          jobId: job.id,
          propertyId: job.data.propertyId,
          fetched: ok.fetched,
          created: ok.created,
          updated: ok.updated,
          repliesMirrored: ok.repliesMirrored,
        },
        'Property reviews synced',
      )
    } catch (err) {
      logger.error(
        { err, jobId: job.id, propertyId: job.data.propertyId },
        'Failed to sync property reviews',
      )
      throw err
    }
  }
}
