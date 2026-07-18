// Review context — BullMQ job handler for publishing replies to Google
// Retries up to 3 times with exponential backoff.
//
// BQC-3.3: provider outcomes are classified via the reply-publication saga
// (classifyPublicationFailure).
//
// BQC-3.8: the publication state machine is DURABLE (replies.publication_state,
// migration 0015). The handler:
//   1. CLAIMS the row — markPublicationSending (approved + authorized|sending
//      → sending, attempts+1). A null claim means the publication was
//      cancelled (disconnect/policy) or the row is no longer claimable:
//      the side effect must NOT run.
//   2. calls Google. The GBP reply PUT is an UPSERT (one reply per review),
//      so retrying any failure class — including an ambiguous one — can never
//      create a duplicate Google-visible reply.
//   3. POST-CALL RACE GUARD — re-reads the reply before the local ack:
//      row missing (purged by the disconnect cascade) or
//      publication_state='cancelled' (disconnect won the race) → return
//      WITHOUT marking. The local truth is cancelled; provider-side cleanup
//      of the orphaned Google-visible reply is out of scope.
//   4. success → markPublished (atomic; also persists
//      publication_state='published' + the published fact).
//   5. failure → classified:
//        terminal_rejection  → markPublicationTerminal (no retry burn)
//        retryable           → markPublicationRetryQueued + rethrow
//        ambiguous non-final → rethrow (state stays 'sending'; the SAME job's
//                              next attempt re-claims sending → sending)
//        ambiguous final     → markPublicationAmbiguous (reconcile_due_at set
//                              for the reconcile-ambiguous-publications sweep)
//                              + rethrow

import type { Job } from 'bullmq'

export const JOB_NAME = 'publish-reply' as const
import type { PublishReplyJobData } from '../../application/ports/reply-queue.port'
import type { ReplyRepository } from '../../application/ports/reply.repository'
import type { ReviewRepository } from '../../application/ports/review.repository'
import type { ReplyCommandStore } from '../../application/ports/reply-command-store.port'
import type { GoogleReviewApiPort } from '../../application/ports/google-review-api.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { ReplyId } from '#/shared/domain/ids'
import type { Reply, Review } from '../../domain/types'
import { replyId, organizationId } from '#/shared/domain/ids'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import { classifyPublicationFailure } from '../../domain/reply-publication-workflow'
import { reviewReplyPublishFailed } from '../../domain/events'
import { markReplyPublished } from '../../application/use-cases/reply-operations'

const MAX_ATTEMPTS = 3

type PublishHandlerDeps = Readonly<{
  replyRepo: ReplyRepository
  reviewRepo: ReviewRepository
  googleReviewApi: GoogleReviewApiPort
  /** BQC-3.3/3.8: atomic mark ops (guarded state + outbox fact in one tx). */
  replyCommandStore: ReplyCommandStore
  clock: () => Date
  idGen: () => ReturnType<typeof replyId>
  // Job-only mark ops share ReplyDeps (which now carries staffPublicApi for the
  // user-facing reply ops). The mark ops don't perform access checks themselves
  // (no authenticated caller), but accept the field to satisfy the shared type.
  staffPublicApi: StaffPublicApi
}>

/** The publish_failed fact — identifier-only, propertyId from the parent review. */
function buildPublishFailedEvent(review: Review, reply: Reply, occurredAt: Date) {
  return reviewReplyPublishFailed({
    replyId: reply.id,
    reviewId: reply.reviewId,
    propertyId: review.propertyId,
    organizationId: reply.organizationId,
    authorId: reply.createdBy,
    occurredAt,
  })
}

export const createPublishReplyHandler = (deps: PublishHandlerDeps) => {
  // No-op queue: mark operations must not re-enqueue a publish job (infinite loop).
  const noopQueue = { addPublishJob: async () => {} }

  const markDeps = {
    replyRepo: deps.replyRepo,
    reviewRepo: deps.reviewRepo,
    queue: noopQueue,
    commandStore: deps.replyCommandStore,
    googleReviewApi: deps.googleReviewApi,
    clock: deps.clock,
    idGen: deps.idGen,
    staffPublicApi: deps.staffPublicApi,
  }
  const doMarkPublished = markReplyPublished(markDeps)

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

      // BQC-3.8: CLAIM the publication (approved + authorized|sending →
      // sending, attempts+1). 'sending' re-claim is the SAME BullMQ job
      // retrying its in-flight workflow after an ambiguous attempt (jobId
      // idempotency serializes attempts — no second worker can hold it).
      // Null = cancelled meanwhile (disconnect/policy) or no longer claimable.
      const claimed = await deps.replyCommandStore.markPublicationSending(reply)
      if (!claimed) {
        logger.warn(
          { replyId: rId },
          'Publication claim lost — cancelled or no longer claimable, skipping',
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
        // A missing connection can never succeed — terminal, no retry burn.
        await deps.replyCommandStore.markPublicationTerminal(
          claimed,
          'terminal_rejection',
          buildPublishFailedEvent(review, claimed, deps.clock()),
        )
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

        // BQC-3.8 POST-CALL RACE GUARD: the disconnect cascade (cancellation +
        // purge) may have run while the Google call was in flight.
        const current = await deps.replyRepo.findById(rId, orgId)
        if (!current) {
          logger.error(
            { replyId: rId },
            'Reply purged during the Google call — provider-visible reply has no local evidence; NOT marking published (provider-side cleanup is out of scope)',
          )
          return
        }
        if (current.publicationState === 'cancelled') {
          logger.warn(
            { replyId: rId },
            'Publication cancelled during the Google call — the local truth is cancelled; NOT marking published',
          )
          return
        }

        await doMarkPublished({ replyId: rId, organizationId: orgId })
        logger.info({ replyId: rId }, 'Reply published to Google')
      } catch (err) {
        await handlePublishFailure(deps, job, claimed, review, rId, err)
      }
    })
  }
}

/** BQC-3.3/3.8: classified failure handling — see the header table. */
async function handlePublishFailure(
  deps: PublishHandlerDeps,
  job: Job<PublishReplyJobData>,
  claimed: Reply,
  review: Review,
  rId: ReplyId,
  err: unknown,
): Promise<void> {
  const logger = getLogger()
  const failure = classifyPublicationFailure(err)
  const attempt = job.attemptsMade + 1
  const finalAttempt = attempt >= MAX_ATTEMPTS

  if (failure === 'terminal_rejection') {
    // Permanent provider answer (4xx / connection gone): retrying cannot
    // succeed. Mark terminal and resolve — remaining attempts must not burn.
    logger.error(
      { err, replyId: rId, attempt },
      'Reply rejected terminally by Google — marked publish_failed without retry',
    )
    await deps.replyCommandStore.markPublicationTerminal(
      claimed,
      'terminal_rejection',
      buildPublishFailedEvent(review, claimed, deps.clock()),
    )
    return
  }

  if (failure === 'retryable') {
    // Transient (429/5xx/token refresh/pre-response network): back to
    // 'authorized' so the next BullMQ attempt (or a quarantine redrive)
    // re-claims; last_error_class and attempts are preserved. Then rethrow.
    logger.error({ err, replyId: rId, attempt }, 'Reply publish failed (retryable)')
    await deps.replyCommandStore.markPublicationRetryQueued(claimed)
    throw err
  }

  if (finalAttempt) {
    // Ambiguous on the FINAL attempt (timeout/unknown AFTER the request may
    // have landed): the reply may exist on Google. Honest unknown →
    // publish_failed + publication_state='ambiguous' + reconcile_due_at; the
    // reconcile-ambiguous-publications sweep (or an operator via
    // reconcileReplyPublication / retryPublish reconcile-before-retry)
    // re-reads provider state before any new publish.
    logger.error(
      { err, replyId: rId, attempt, reconcile: 'reconcileReplyPublication' },
      'Ambiguous publish outcome on final attempt — marked publish_failed; reconcile before retrying',
    )
    await deps.replyCommandStore.markPublicationAmbiguous(
      claimed,
      buildPublishFailedEvent(review, claimed, deps.clock()),
    )
    throw err
  }

  // Ambiguous on a non-final attempt: the state stays 'sending' — the SAME
  // BullMQ job's next attempt re-claims (sending → sending is the claim of an
  // in-flight workflow; jobId idempotency serializes attempts, so no second
  // worker can race the claim). Marking anything here would lie about an
  // outcome we do not know.
  logger.error(
    { err, replyId: rId, attempt },
    'Reply publish outcome ambiguous — retrying',
  )
  throw err
}
