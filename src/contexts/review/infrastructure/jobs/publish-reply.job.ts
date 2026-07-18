// Review context — BullMQ job handler for publishing replies to Google
// Retries up to 3 times with exponential backoff.
//
// BQC-3.3: provider outcomes are classified via the reply-publication saga
// (classifyPublicationFailure):
//   success             → markPublished (atomic state + published fact)
//   terminal_rejection  → markPublishFailed WITHOUT burning BullMQ retries
//   retryable           → rethrow for the configured BullMQ attempts
//   ambiguous           → rethrow until the FINAL attempt, then mark
//                         publish_failed (honest unknown) with a
//                         reconciliation hint (reconcileReplyPublication)
//
// The GBP reply PUT is an UPSERT (one reply per review), so retrying any
// failure class — including an ambiguous one — can never create a duplicate
// Google-visible reply.

import type { Job } from 'bullmq'

export const JOB_NAME = 'publish-reply' as const
import type { PublishReplyJobData } from '../../application/ports/reply-queue.port'
import type { ReplyRepository } from '../../application/ports/reply.repository'
import type { ReviewRepository } from '../../application/ports/review.repository'
import type { ReplyCommandStore } from '../../application/ports/reply-command-store.port'
import type { GoogleReviewApiPort } from '../../application/ports/google-review-api.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { replyId, organizationId } from '#/shared/domain/ids'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import { classifyPublicationFailure } from '../../domain/reply-publication-workflow'
import {
  markReplyPublished,
  markReplyPublishFailed,
} from '../../application/use-cases/reply-operations'

const MAX_ATTEMPTS = 3

type PublishHandlerDeps = Readonly<{
  replyRepo: ReplyRepository
  reviewRepo: ReviewRepository
  googleReviewApi: GoogleReviewApiPort
  /** BQC-3.3: atomic mark ops (state + outbox fact in one tx). */
  replyCommandStore: ReplyCommandStore
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

  const markDeps = {
    replyRepo: deps.replyRepo,
    reviewRepo: deps.reviewRepo,
    queue: noopQueue,
    commandStore: deps.replyCommandStore,
    clock: deps.clock,
    idGen: deps.idGen,
    staffPublicApi: deps.staffPublicApi,
  }
  const doMarkPublished = markReplyPublished(markDeps)
  const doMarkFailed = markReplyPublishFailed(markDeps)

  return async (job: Job<PublishReplyJobData>) => {
    return trace('job.publishReply', async () => {
      const logger = getLogger()

      // BQC-3.2: capability authorization happens at dispatch in the delayed
      // execution gate — job handlers no longer re-check capabilities.

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
        await handlePublishFailure(doMarkFailed, job, rId, orgId, err)
      }
    })
  }
}

type MarkFailed = (input: {
  replyId: ReturnType<typeof replyId>
  organizationId: ReturnType<typeof organizationId>
}) => Promise<unknown>

/** BQC-3.3: classified failure handling — see the header table. */
async function handlePublishFailure(
  doMarkFailed: MarkFailed,
  job: Job<PublishReplyJobData>,
  rId: ReturnType<typeof replyId>,
  orgId: ReturnType<typeof organizationId>,
  err: unknown,
): Promise<void> {
  const logger = getLogger()
  const failure = classifyPublicationFailure(err)
  const attempt = job.attemptsMade + 1
  const finalAttempt = attempt >= MAX_ATTEMPTS

  if (failure === 'terminal_rejection') {
    // Permanent provider answer (4xx / connection gone): retrying cannot
    // succeed. Mark failed and resolve — remaining attempts must not burn.
    logger.error(
      { err, replyId: rId, attempt },
      'Reply rejected terminally by Google — marked publish_failed without retry',
    )
    await doMarkFailed({ replyId: rId, organizationId: orgId })
    return
  }

  if (failure === 'ambiguous' && finalAttempt) {
    // Timeout/unknown AFTER the request may have landed: the reply may exist
    // on Google. Honest unknown → publish_failed; an operator must reconcile
    // provider state (reconcileReplyPublication) before any new publish.
    logger.error(
      { err, replyId: rId, attempt, reconcile: 'reconcileReplyPublication' },
      'Ambiguous publish outcome on final attempt — marked publish_failed; reconcile before retrying',
    )
    await doMarkFailed({ replyId: rId, organizationId: orgId })
    throw err
  }

  logger.error({ err, replyId: rId, attempt }, 'Reply publish failed')

  if (finalAttempt) {
    logger.error({ replyId: rId }, 'Reply publish failed after all retries')
    await doMarkFailed({ replyId: rId, organizationId: orgId })
  }

  throw err
}
