// Review context — build function (composition root)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."
// Returns the public API surface of the review context.

import { reviewError } from './domain/errors'
import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { Queue } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { GoogleReviewApiPort } from './application/ports/google-review-api.port'
import type { ReviewRepository } from './application/ports/review.repository'
import type { ReplyRepository } from './application/ports/reply.repository'
import type { ReviewQueuePort } from './application/ports/review-queue.port'
import type { ReplyQueuePort } from './application/ports/reply-queue.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
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
import { getStaffRecentActivity } from './application/use-cases/get-staff-recent-activity'
import { reviewId, replyId } from '#/shared/domain/ids'
import { registerReviewHandlers } from './infrastructure/event-handlers'

export type ReviewContextBuildInput = Readonly<{
  db: Database
  events: EventBus
  clock: () => Date
  googleReviewApi: GoogleReviewApiPort
  jobQueue: Queue | undefined
  logger: LoggerPort
  staffPublicApi: StaffPublicApi
}>

export type ReviewContextApi = Readonly<{
  publicApi: Readonly<Record<string, never>>
  internal: Readonly<{
    repos: Readonly<{
      reviewRepo: ReviewRepository
      replyRepo: ReplyRepository
      queue: ReviewQueuePort
      replyQueue: ReplyQueuePort
    }>
    useCases: Readonly<{
      syncReviews: ReturnType<typeof syncReviews>
      draftReply: ReturnType<typeof draftReply>
      submitReply: ReturnType<typeof submitReply>
      approveReply: ReturnType<typeof approveReply>
      rejectReply: ReturnType<typeof rejectReply>
      deleteReply: ReturnType<typeof deleteReply>
      getReply: ReturnType<typeof getReply>
      retryPublish: ReturnType<typeof retryPublish>
      getStaffRecentActivity: ReturnType<typeof getStaffRecentActivity>
    }>
  }>
}>

export const buildReviewContext = (input: ReviewContextBuildInput): ReviewContextApi => {
  const reviewRepo = createReviewRepository(input.db)
  const replyRepo = createReplyRepository(input.db)

  if (!input.jobQueue)
    throw reviewError(
      'build_config_error',
      'jobQueue is required to build review context',
    )
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
    staffPublicApi: input.staffPublicApi,
  }

  registerReviewHandlers({
    events: input.events,
    queue,
  })

  const useCases = {
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
    getStaffRecentActivity: getStaffRecentActivity({
      reviewRepo,
      staffPublicApi: input.staffPublicApi,
    }),
  }

  return {
    publicApi: {} as const,
    internal: {
      repos: {
        reviewRepo,
        replyRepo,
        queue,
        replyQueue,
      },
      useCases,
    },
  }
}
