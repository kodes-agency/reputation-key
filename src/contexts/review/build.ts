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
import { createAtomicReviewCommandStore } from './infrastructure/review-command-store'
import { createAtomicReplyCommandStore } from './infrastructure/reply-command-store'
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
import { reconcileReplyPublication } from './application/use-cases/reconcile-reply-publication'
import { getStaffRecentActivity } from './application/use-cases/get-staff-recent-activity'
import { createEligibleReads, type EligibleReads } from './application/eligible-reads'
import { reviewId, replyId } from '#/shared/domain/ids'
import { jobEnqueueOptions } from '#/shared/jobs/job-policy'
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
  /** BQC-1.4: the governed read interface for review content. */
  publicApi: EligibleReads
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
      reconcileReplyPublication: ReturnType<typeof reconcileReplyPublication>
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
        // BQC-3.6: attempts/backoff+jitter/timeout from the job catalogue.
        ...jobEnqueueOptions('sync-property-reviews'),
      })
    },
  }

  const replyQueue: ReplyQueuePort = {
    addPublishJob: async (data, options) => {
      await jobQueue.add('publish-reply', data, {
        // BQC-3.3: saga idempotency key as BullMQ jobId — a duplicate enqueue
        // of the same approval cycle is deduped by the queue.
        jobId: options?.idempotencyKey,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
        // BQC-3.6: attempts/backoff+jitter/timeout from the job catalogue
        // (exponential:5000 + 120s timeout for publish-reply).
        ...jobEnqueueOptions('publish-reply'),
      })
    },
  }

  // BQC-3.3: atomic reply state + outbox writes for the reply command family.
  // This closes the replyDeps wiring gap — reply facts were previously
  // bus-only in production because replyDeps never received outboxRepo.
  const replyCommandStore = createAtomicReplyCommandStore(input.db, input.events)

  const replyDeps = {
    replyRepo,
    reviewRepo,
    queue: replyQueue,
    commandStore: replyCommandStore,
    clock: input.clock,
    idGen: () => replyId(crypto.randomUUID()),
    staffPublicApi: input.staffPublicApi,
  }

  registerReviewHandlers({
    events: input.events,
    queue,
  })

  // BQR-2.3: atomic review upsert + outbox insert for sync path
  const commandStore = createAtomicReviewCommandStore(input.db, input.events)

  const useCases = {
    syncReviews: syncReviews({
      reviewRepo,
      replyRepo,
      googleReviewApi: input.googleReviewApi,
      clock: input.clock,
      idGen: () => reviewId(crypto.randomUUID()),
      replyIdGen: () => replyId(crypto.randomUUID()),
      logger: input.logger,
      commandStore,
      replyCommandStore,
    }),
    draftReply: draftReply(replyDeps),
    submitReply: submitReply(replyDeps),
    approveReply: approveReply(replyDeps),
    rejectReply: rejectReply(replyDeps),
    deleteReply: deleteReply(replyDeps),
    getReply: getReply(replyDeps),
    retryPublish: retryPublish(replyDeps),
    reconcileReplyPublication: reconcileReplyPublication({
      replyRepo,
      reviewRepo,
      googleReviewApi: input.googleReviewApi,
      commandStore: replyCommandStore,
      clock: input.clock,
    }),
    getStaffRecentActivity: getStaffRecentActivity({
      reviewRepo,
      staffPublicApi: input.staffPublicApi,
      clock: input.clock,
    }),
  }

  return {
    publicApi: createEligibleReads({ reviewRepo, clock: input.clock }),
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
