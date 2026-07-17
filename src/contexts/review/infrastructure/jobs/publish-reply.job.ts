// Review context — BullMQ job handler for publishing replies to Google
// Retries up to 3 times with exponential backoff. On final failure, marks reply as publish_failed.

import type { Job } from 'bullmq'

export const JOB_NAME = 'publish-reply' as const
import type { PublishReplyJobData } from '../../application/ports/reply-queue.port'
import type { ReplyRepository } from '../../application/ports/reply.repository'
import type { ReviewRepository } from '../../application/ports/review.repository'
import type { GoogleReviewApiPort } from '../../application/ports/google-review-api.port'
import type { EventBus } from '#/shared/events/event-bus'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { replyId, organizationId } from '#/shared/domain/ids'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import { isCapabilityJobEnabled } from '#/shared/auth/beta-capabilities'
import {
  markReplyPublished,
  markReplyPublishFailed,
} from '../../application/use-cases/reply-operations'

const MAX_ATTEMPTS = 3

type PublishHandlerDeps = Readonly<{
  replyRepo: ReplyRepository
  reviewRepo: ReviewRepository
  googleReviewApi: GoogleReviewApiPort
  events: EventBus
  clock: () => Date
  idGen: () => ReturnType<typeof replyId>
  // Job-only mark ops share ReplyDeps (which now carries staffPublicApi for the
  // user-facing reply ops). The mark ops don't perform access checks themselves
  // (no authenticated caller), but accept the field to satisfy the shared type.
  staffPublicApi: StaffPublicApi
}>

export const createPublishReplyHandler = (deps: PublishHandlerDeps) => {
  // No-op queue: mark operations must not re-enqueue a publish job (infinite loop).
  const noopQueue = { addPublishJob: async () => {} }

  const doMarkPublished = markReplyPublished({
    replyRepo: deps.replyRepo,
    reviewRepo: deps.reviewRepo,
    queue: noopQueue,
    events: deps.events,
    clock: deps.clock,
    idGen: deps.idGen,
    staffPublicApi: deps.staffPublicApi,
  })

  const doMarkFailed = markReplyPublishFailed({
    replyRepo: deps.replyRepo,
    reviewRepo: deps.reviewRepo,
    queue: noopQueue,
    events: deps.events,
    clock: deps.clock,
    idGen: deps.idGen,
    staffPublicApi: deps.staffPublicApi,
  })

  return async (job: Job<PublishReplyJobData>) => {
    return trace('job.publishReply', async () => {
      const logger = getLogger()

      // BQC-0.4 stop control: already-enqueued work must not call Google after
      // the capability is switched off (jobs are skipped, not deleted).
      if (!isCapabilityJobEnabled('property.publish_reply')) {
        logger.info(
          { jobId: job.id, replyId: job.data.replyId },
          'BQC-0.4: publish skipped — property.publish_reply is disabled',
        )
        return
      }

      const rId = replyId(job.data.replyId)
      const orgId = organizationId(job.data.organizationId)

      logger.info({ jobId: job.id, replyId: rId }, 'Publishing reply to Google')

      const reply = await deps.replyRepo.findById(rId, orgId)
      if (!reply) {
        logger.error({ replyId: rId }, 'Reply not found, skipping')
        return
      }

      if (reply.status !== 'approved') {
        logger.warn(
          { replyId: rId, status: reply.status },
          'Reply not in approved status, skipping',
        )
        return
      }

      const review = await deps.reviewRepo.findById(reply.reviewId, orgId)
      if (!review) {
        logger.error({ reviewId: reply.reviewId }, 'Review not found for reply')
        return
      }

      if (!review.googleConnectionId) {
        logger.error(
          { reviewId: review.id },
          'Review has no Google connection, cannot publish',
        )
        await doMarkFailed({ replyId: rId, organizationId: orgId })
        return
      }

      const reviewName = `${review.externalLocationId}/reviews/${review.externalId}`

      try {
        await deps.googleReviewApi.replyToReview(
          orgId,
          review.googleConnectionId,
          reviewName,
          reply.text,
        )

        await doMarkPublished({ replyId: rId, organizationId: orgId })
        logger.info({ replyId: rId }, 'Reply published to Google')
      } catch (err) {
        logger.error(
          { err, replyId: rId, attempt: job.attemptsMade + 1 },
          'Reply publish failed',
        )

        if (job.attemptsMade + 1 >= MAX_ATTEMPTS) {
          logger.error({ replyId: rId }, 'Reply publish failed after all retries')
          await doMarkFailed({ replyId: rId, organizationId: orgId })
        }

        throw err
      }
    })
  }
}
