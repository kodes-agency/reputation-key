// Review context — build function (composition root)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."
// Returns the public API surface of the review context.

import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { Queue } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { GoogleReviewApiPort } from './application/ports/google-review-api.port'
import type { ReviewRepository } from './application/ports/review.repository'
import type { ReplyRepository } from './application/ports/reply.repository'
import type { ReviewQueuePort } from './application/ports/review-queue.port'
import type { ReplyQueuePort } from './application/ports/reply-queue.port'
import { createReviewRepository } from './infrastructure/repositories/review.repository'
import { createReplyRepository } from './infrastructure/repositories/reply.repository'
import { syncReviews } from './application/use-cases/sync-reviews'
import {
  draftReply,
  submitReply,
  approveReply,
  rejectReply,
  deleteReply,
  getReply,
  retryPublish,
} from './application/use-cases/reply-operations'
import { reviewId, replyId } from '#/shared/domain/ids'
import { registerReviewHandlers } from './infrastructure/event-handlers'

export type ReviewContextBuildInput = Readonly<{
  db: Database
  events: EventBus
  clock: () => Date
  googleReviewApi: GoogleReviewApiPort
  jobQueue: Queue | undefined
  logger: LoggerPort
}>

export type ReviewContextApi = Readonly<{
  syncReviews: ReturnType<typeof syncReviews>
  draftReply: ReturnType<typeof draftReply>
  submitReply: ReturnType<typeof submitReply>
  approveReply: ReturnType<typeof approveReply>
  rejectReply: ReturnType<typeof rejectReply>
  deleteReply: ReturnType<typeof deleteReply>
  getReply: ReturnType<typeof getReply>
  retryPublish: ReturnType<typeof retryPublish>
  reviewRepo: ReviewRepository
  replyRepo: ReplyRepository
  queue: ReviewQueuePort
  replyQueue: ReplyQueuePort
}>

export const buildReviewContext = (input: ReviewContextBuildInput): ReviewContextApi => {
  const reviewRepo = createReviewRepository(input.db)
  const replyRepo = createReplyRepository(input.db)

  if (!input.jobQueue) throw new Error('jobQueue required')
  const jobQueue = input.jobQueue

  const queue: ReviewQueuePort = {
    addSyncJob: async (data, options) => {
      await jobQueue.add('sync-property-reviews', data, {
        jobId: options?.jobId,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
        attempts: 3,
      })
    },
  }

  const replyQueue: ReplyQueuePort = {
    addPublishJob: async (data) => {
      await jobQueue.add('publish-reply', data, {
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      })
    },
  }

  const replyDeps = {
    replyRepo,
    reviewRepo,
    queue: replyQueue,
    events: input.events,
    clock: input.clock,
    idGen: () => replyId(crypto.randomUUID()),
  }

  registerReviewHandlers({
    events: input.events,
    queue,
  })

  return {
    syncReviews: syncReviews({
      reviewRepo,
      replyRepo,
      googleReviewApi: input.googleReviewApi,
      events: input.events,
      clock: input.clock,
      idGen: () => reviewId(crypto.randomUUID()),
      replyIdGen: () => replyId(crypto.randomUUID()),
      logger: input.logger,
    }),
    draftReply: draftReply(replyDeps),
    submitReply: submitReply(replyDeps),
    approveReply: approveReply(replyDeps),
    rejectReply: rejectReply(replyDeps),
    deleteReply: deleteReply(replyDeps),
    getReply: getReply(replyDeps),
    retryPublish: retryPublish(replyDeps),
    reviewRepo,
    replyRepo,
    queue,
    replyQueue,
  } as const
}
