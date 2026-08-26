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
//   2. a persisted `sending` state is uncertain: perform a targeted provider
//      read first. A live exact/divergent reply is recorded and stops the
//      attempt; only an observed absence permits a new guarded write attempt.
//      A fresh authorized attempt then calls Google once.
//   3. POST-CALL RACE GUARD — re-reads the reply before the local ack:
//      row missing (purged by the disconnect cascade) or
//      publication_state='cancelled' (disconnect won the race) → return
//      WITHOUT marking. The local truth is cancelled; provider-side cleanup
//      of the orphaned Google-visible reply is out of scope.
//   4. successful write response → persist provider outcome as
//      pending_observation. It is never publication proof; only a later exact,
//      current provider read may publish the local Reply.
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
import type { GoogleReplyObservationStore } from '../../application/ports/google-reply-observation-store.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { Reply, Review } from '../../domain/types'
import { replyId, organizationId, propertyId } from '#/shared/domain/ids'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import { classifyPublicationFailure } from '../../domain/reply-publication-workflow'
import { reviewReplyPublishFailed } from '../../domain/events'
import { sha256Hex } from '#/shared/domain/sha256'
import { contentExpiresAtFromFetch } from '#/shared/domain/source-content-policy'

const MAX_ATTEMPTS = 3

type PublishHandlerDeps = Readonly<{
  replyRepo: ReplyRepository
  reviewRepo: ReviewRepository
  googleReviewApi: GoogleReviewApiPort
  googleReplyObservationStore: GoogleReplyObservationStore
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
  return async (job: Job<PublishReplyJobData>) => {
    return trace('job.publishReply', async () => {
      const logger = getLogger()

      // BQC-3.2: capability authorization happens at dispatch in the delayed
      // execution gate — job handlers no longer re-check capabilities.

      const rId = replyId(job.data.replyId)
      const orgId = organizationId(job.data.organizationId)

      logger.info('Publishing reply to Google')

      const reply = await deps.replyRepo.findById(rId, orgId)
      if (!reply) {
        logger.error('Reply not found, skipping')
        return
      }

      if (reply.status !== 'approved') {
        logger.warn({ status: reply.status }, 'Reply not in approved status, skipping')
        return
      }

      // RPL-01: a durable intent or fast-path job may arrive after a later
      // approval/edit/retry cycle has become current. The explicit monotonic
      // cycle is the fence: stale work stops before it can claim the row or
      // reach the provider. A missing value is accepted only for a bounded
      // pre-RPL-01 job whose persisted row is still at legacy cycle zero.
      const requestedCycle = job.data.publicationCycle
      const jobCycle = requestedCycle ?? 0
      const hasCurrentAuthorizationFence =
        typeof job.data.propertyId === 'string' &&
        Number.isSafeInteger(job.data.sourceEpoch) &&
        job.data.sourceEpoch! >= 0 &&
        Number.isSafeInteger(job.data.materialReviewRevision) &&
        job.data.materialReviewRevision! > 0 &&
        Number.isSafeInteger(job.data.baseObservationRevision) &&
        job.data.baseObservationRevision! >= 0
      if (
        (requestedCycle === undefined && reply.publicationCycle !== 0) ||
        (requestedCycle !== undefined && requestedCycle !== reply.publicationCycle) ||
        (reply.publicationCycle > 0 && !hasCurrentAuthorizationFence)
      ) {
        logger.warn('Publication cycle superseded — skipping stale job')
        return
      }

      const review = await deps.reviewRepo.findById(reply.reviewId, orgId)
      if (!review) {
        logger.error('Review not found for reply')
        return
      }
      if (
        reply.publicationCycle > 0 &&
        (job.data.propertyId !== review.propertyId ||
          job.data.sourceEpoch !== review.sourceEpoch ||
          job.data.materialReviewRevision !== review.sourceRevision)
      ) {
        logger.warn('Publication authorization no longer matches the Review source')
        return
      }

      const reviewName =
        review.externalLocationId && review.externalId
          ? `${review.externalLocationId}/reviews/${review.externalId}`
          : null

      // A persisted `sending` row means a previous attempt may have reached
      // Google without its local outcome being committed. Never issue another
      // PUT until a targeted read proves the reply absent. A live reply—exact
      // or divergent—is recorded by the observation authority and stops here.
      if (
        reply.publicationState === 'sending' &&
        review.googleConnectionId &&
        reviewName
      ) {
        const mayResend = await reconcileUncertainAttempt(
          deps,
          job,
          reply,
          review,
          reviewName,
        )
        if (!mayResend) return
      }

      // BQC-3.8: CLAIM the publication (approved + authorized|sending →
      // sending, attempts+1). 'sending' re-claim is the SAME BullMQ job
      // retrying its in-flight workflow after an ambiguous attempt (jobId
      // idempotency serializes attempts — no second worker can hold it).
      // Null = cancelled meanwhile (disconnect/policy) or no longer claimable.
      const claimed = await deps.replyCommandStore.markPublicationSending(reply, {
        providerOperationKey: `${String(job.id ?? reply.id)}:${job.attemptsMade + 1}`,
        propertyId: propertyId(job.data.propertyId ?? review.propertyId),
        sourceEpoch: job.data.sourceEpoch ?? review.sourceEpoch,
        materialReviewRevision: job.data.materialReviewRevision ?? review.sourceRevision,
        baseObservationRevision: job.data.baseObservationRevision ?? 0,
      })
      if (!claimed) {
        logger.warn('Publication claim lost — cancelled or no longer claimable, skipping')
        return
      }

      if (!review.googleConnectionId || !reviewName) {
        logger.error('Review has no current Google provider subject, cannot publish')
        await deps.replyCommandStore.markPublicationTerminal(
          claimed,
          'terminal_rejection',
          buildPublishFailedEvent(review, claimed, deps.clock()),
        )
        return
      }

      try {
        const providerOutcome = await deps.googleReviewApi.replyToReview(
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
            'Reply purged during the Google call — provider-visible reply has no local evidence; NOT marking published (provider-side cleanup is out of scope)',
          )
          return
        }
        if (current.publicationState === 'cancelled') {
          logger.warn(
            'Publication cancelled during the Google call — the local truth is cancelled; NOT marking published',
          )
          return
        }
        if (current.publicationCycle !== jobCycle) {
          logger.warn(
            'Publication cycle changed during the Google call — NOT acknowledging the stale cycle',
          )
          return
        }

        const now = deps.clock()
        // Use the exact row claimed by THIS cycle. The store's status+cycle
        // compare-and-set is the final fence between the post-call read above
        // and this acknowledgement; a cancellation/re-authorization in that
        // narrow window cannot make the old provider result publish cycle N+1.
        const pending =
          await deps.replyCommandStore.markProviderOutcomePendingObservation(
            claimed,
            {
              providerCorrelationId: providerOutcome.providerCorrelationId,
              providerRespondedAt: now,
            },
            now,
          )
        if (!pending) {
          logger.warn(
            'Publication acknowledgement lost the state/cycle fence — NOT marking a newer cycle',
          )
          return
        }
        logger.info('Google write accepted; awaiting provider observation')
      } catch (err) {
        await handlePublishFailure(deps, job, claimed, review, err)
      }
    })
  }
}

async function reconcileUncertainAttempt(
  deps: PublishHandlerDeps,
  job: Job<PublishReplyJobData>,
  reply: Reply,
  review: Review,
  reviewName: string,
): Promise<boolean> {
  if (!review.googleConnectionId) return false
  const result = await deps.googleReviewApi.getReview({
    organizationId: reply.organizationId,
    propertyId: review.propertyId,
    connectionId: review.googleConnectionId,
    sourceEpoch: review.sourceEpoch,
    locationName: review.externalLocationId,
    reviewName,
  })
  // A missing Review is not evidence that a retry is safe. Source lifecycle
  // reconciliation owns that case; sending another write would target an
  // unverified provider subject.
  if (result.status === 'not_found') return false

  // Allocate after acquiring the response: concurrent targeted reads are
  // ordered by the truth they actually received, not by request start time.
  const readGeneration = await deps.googleReplyObservationStore.allocateReadGeneration()
  const observedAt = deps.clock()

  await deps.googleReplyObservationStore.record({
    organizationId: reply.organizationId,
    propertyId: review.propertyId,
    reviewId: reply.reviewId,
    sourceEpoch: review.sourceEpoch,
    materialReviewRevision: review.sourceRevision,
    observationKey: sha256Hex(
      [
        'publish-readback-v2',
        String(job.id ?? ''),
        String(reply.id),
        String(reply.publicationCycle),
        String(reply.publicationAttempts),
        String(job.attemptsMade),
        String(review.sourceEpoch),
        String(review.sourceRevision),
        String(readGeneration),
        result.review.replyUpdatedAt?.toISOString() ?? 'none',
        result.review.replyText === null
          ? 'reply-state:absent'
          : `reply-state:live:${sha256Hex(result.review.replyText)}`,
      ].join('\0'),
    ),
    source: 'targeted_reconciliation',
    publicationTarget: {
      replyId: reply.id,
      publicationCycle: reply.publicationCycle,
      attemptNumber: reply.publicationAttempts,
    },
    readGeneration,
    observedText: result.review.replyText,
    providerUpdatedAt: result.review.replyUpdatedAt,
    observedAt,
    contentExpiresAt: contentExpiresAtFromFetch(observedAt),
  })
  return result.review.replyText === null
}

/** BQC-3.3/3.8: classified failure handling — see the header table. */
async function handlePublishFailure(
  deps: PublishHandlerDeps,
  job: Job<PublishReplyJobData>,
  claimed: Reply,
  review: Review,
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
      { err, attempt },
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
    // Provably pre-dispatch transient failure or explicit rate-limit response:
    // back to 'authorized' so the next BullMQ attempt (or a quarantine
    // redrive) re-claims; last_error_class and attempts are preserved.
    logger.error({ err, attempt }, 'Reply publish failed (retryable)')
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
      { err, attempt, reconcile: 'reconcileReplyPublication' },
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
  logger.error({ err, attempt }, 'Reply publish outcome ambiguous — retrying')
  throw err
}
