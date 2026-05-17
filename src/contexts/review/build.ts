// Review context — build function (composition root)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."
// Returns the public API surface of the review context.

import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { Queue } from 'bullmq'
import type { GoogleReviewApiPort } from './application/ports/google-review-api.port'
import type { ReviewRepository } from './application/ports/review.repository'
import type { ReplyRepository } from './application/ports/reply.repository'
import type { ReviewQueuePort } from './application/ports/review-queue.port'
import { createReviewRepository } from './infrastructure/repositories/review.repository'
import { createReplyRepository } from './infrastructure/repositories/reply.repository'
import { syncReviews } from './application/use-cases/sync-reviews'
import { reviewId, replyId } from '#/shared/domain/ids'

export type ReviewContextBuildInput = Readonly<{
  db: Database
  events: EventBus
  clock: () => Date
  googleReviewApi: GoogleReviewApiPort
  jobQueue: Queue | undefined
}>

export type ReviewContextApi = Readonly<{
  syncReviews: ReturnType<typeof syncReviews>
  reviewRepo: ReviewRepository
  replyRepo: ReplyRepository
  queue: ReviewQueuePort
}>

export const buildReviewContext = (input: ReviewContextBuildInput): ReviewContextApi => {
  const reviewRepo = createReviewRepository(input.db)
  const replyRepo = createReplyRepository(input.db)

  // Queue port — created here to match integration context pattern
  const queue: ReviewQueuePort = input.jobQueue
    ? {
        addSyncJob: async (data) => {
          await input.jobQueue!.add('sync-property-reviews', data, {
            removeOnComplete: { count: 100 },
            removeOnFail: { count: 50 },
            attempts: 3,
          })
        },
      }
    : {
        addSyncJob: async () => {
          throw new Error('Job queue not available — Redis not configured')
        },
      }

  return {
    syncReviews: syncReviews({
      reviewRepo,
      replyRepo,
      googleReviewApi: input.googleReviewApi,
      events: input.events,
      clock: input.clock,
      idGen: () => reviewId(crypto.randomUUID()),
      replyIdGen: () => replyId(crypto.randomUUID()),
    }),
    reviewRepo,
    replyRepo,
    queue,
  }
}
