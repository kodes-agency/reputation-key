// Review context — the read of Google that comes before a publish claim.
//
// `reviews.reply` is an upsert: it creates the owner reply or replaces the one
// there, with no precondition. About 97% of replies on the beta are written
// directly on Google, and RepKey learns of them only at a sync. So before the
// job claims a fresh publication it reads the review from Google and records
// what it saw through the writer sync and push use. A reply RepKey had not
// seen moves the observation head, and the existing head fence ends the cycle:
//
//   - a cycle that has not sent: the observation store itself cancels it, in
//     the transaction that records the observation (cause `provider_truth`);
//   - a requeued cycle (it was tried and went back to `authorized`): the store
//     leaves it, the claim refuses it, and this module cancels it the same way;
//   - the claim (reply-command-store.ts markPublicationSending) compares the
//     head with the one the manager authorized against. That comparison is the
//     only fence; nothing here adds a second one.
//
// A reply typed on Google between this read and the write is still overwritten
// (the window is now about a second); Google's upsert offers no precondition.
// Replies Google holds back for moderation are not modelled yet (the adapter
// reads a reply as comment and update time only), so one of those is not seen.
//
// Nothing is claimed before the read, so a failed read consumes nothing: the
// row stays `authorized` and BullMQ's own retry runs the job again.

import type { Job } from 'bullmq'
import type { PublishReplyJobData } from '../../application/ports/reply-queue.port'
import type { ReplyRepository } from '../../application/ports/reply.repository'
import type { GoogleReplyObservationStore } from '../../application/ports/google-reply-observation-store.port'
import type { ReadReviewBeforePublish } from '../../application/use-cases/read-review-before-publish'
import type { Reply, Review } from '../../domain/types'
import {
  classifyPublicationFailure,
  publicationFailureCause,
  publicationFailureEvidence,
} from '../../domain/reply-publication-workflow'
import { organizationId, propertyId, googleConnectionId } from '#/shared/domain/ids'
import {
  buildPublishFailedEvent,
  cancelPublicationCycle,
  contentFreeErrorIdentity,
  MAX_PUBLISH_ATTEMPTS,
  refusedForPropertySource,
  type PublishCycleDeps,
} from './publish-reply-support'

export type PrereadDeps = PublishCycleDeps &
  Readonly<{
    replyRepo: Pick<ReplyRepository, 'findById'>
    googleReplyObservationStore: Pick<GoogleReplyObservationStore, 'findCurrentHead'>
    readBeforePublish: ReadReviewBeforePublish
  }>

export type PrereadTarget = Readonly<{
  reply: Reply
  review: Review
  reviewName: string | null
}>

/** Whether this job reads Google first: a fresh `authorized` cycle on a Review
 * that has a Google subject. A persisted `sending` row is read back instead, and
 * a Review with no subject is refused after the claim, as before. */
export function readsGoogleBeforeClaim(target: PrereadTarget): boolean {
  return (
    target.reply.publicationState === 'authorized' &&
    target.review.googleConnectionId !== null &&
    target.reviewName !== null
  )
}

/** The cycle is as the job found it: nobody cancelled, advanced or sent it. */
function isSameAuthorizedCycle(current: Reply | null, original: Reply): current is Reply {
  return (
    current !== null &&
    current.status === 'approved' &&
    current.publicationState === 'authorized' &&
    current.publicationCycle === original.publicationCycle &&
    current.publicationAttempts === original.publicationAttempts
  )
}

/**
 * Read the review from Google and record it. Resolves with the Reply to claim
 * (reloaded, because recording may have changed it), or null when the job ends
 * here: the cycle was cancelled, refused, or no longer exists. Rethrows a
 * failure that BullMQ should retry.
 */
export async function readGoogleBeforeClaim(
  deps: PrereadDeps,
  job: Job<PublishReplyJobData>,
  target: PrereadTarget,
): Promise<Reply | null> {
  const { reply, review, reviewName } = target
  if (review.googleConnectionId === null || reviewName === null) return null

  let result
  try {
    result = await deps.readBeforePublish({
      organizationId: organizationId(reply.organizationId),
      propertyId: propertyId(review.propertyId),
      connectionId: googleConnectionId(review.googleConnectionId),
      sourceEpoch: review.sourceEpoch,
      locationName: review.externalLocationId,
      reviewName,
      readKey: `${reply.id}:${reply.publicationCycle}:${job.attemptsMade}`,
    })
  } catch (err) {
    await handlePrereadFailure(deps, job, reply, review, err)
    return null
  }

  if (result.status === 'obsolete') {
    await cancelPublicationCycle(deps, reply, review, 'policy')
    deps.logger.warn(
      'Reply publication stopped before sending: its Property is no longer active at the cycle source epoch; cancelled as policy',
    )
    return null
  }
  if (result.status === 'review_missing') {
    // Parity with a 404 on the write: Google no longer has the review.
    deps.logger.error(
      'Google no longer has the review; the reply cannot be published — marked publish_failed without retry',
    )
    await deps.replyCommandStore.markPublicationTerminal(
      reply,
      'terminal_rejection',
      buildPublishFailedEvent(review, reply, deps.clock(), 'refused'),
    )
    return null
  }

  // Recording may have ended the cycle (a reply RepKey had not seen, a guest
  // edit) and always changes the Reply's revision: claim the row as it is now.
  const current = await deps.replyRepo.findById(
    reply.id,
    organizationId(reply.organizationId),
  )
  if (!isSameAuthorizedCycle(current, reply)) {
    deps.logger.warn(
      'Publication cycle ended while Google was read — a different reply is live or the review changed; nothing claimed or sent',
    )
    return null
  }
  if (result.status === 'reply_unreadable') {
    // Google shows a reply whose text it did not return. Nothing can be
    // recorded for it, and the write would replace it.
    const cancelled = await cancelPublicationCycle(
      deps,
      current,
      review,
      'provider_truth',
    )
    deps.logger.warn(
      { cancelled },
      'Google shows a reply RepKey cannot read; publication cancelled as provider truth, nothing sent',
    )
    return null
  }
  return current
}

/**
 * The claim was refused after a read. A cycle that had never been tried is
 * already settled by the observation store, so only a requeued one needs this:
 * when the head moved since the manager authorized it, a reply RepKey had not
 * seen is live, and the cycle ends as provider truth rather than waiting for
 * the sweep to call it "safe to try again".
 */
export async function cancelRequeuedCycleWhenHeadMoved(
  deps: PrereadDeps,
  job: Job<PublishReplyJobData>,
  claimAttempted: Reply,
  review: Review,
): Promise<void> {
  if (claimAttempted.publicationAttempts === 0) return
  const current = await deps.replyRepo.findById(
    claimAttempted.id,
    organizationId(claimAttempted.organizationId),
  )
  if (!isSameAuthorizedCycle(current, claimAttempted)) return
  const head = await deps.googleReplyObservationStore.findCurrentHead({
    organizationId: organizationId(claimAttempted.organizationId),
    propertyId: propertyId(review.propertyId),
    reviewId: claimAttempted.reviewId,
  })
  // The claim's own comparison (reply-command-store.ts markPublicationSending).
  if ((head?.observationRevision ?? 0) === (job.data.baseObservationRevision ?? 0)) return
  const cancelled = await cancelPublicationCycle(deps, current, review, 'provider_truth')
  deps.logger.warn(
    { cancelled },
    'Requeued reply publication refused: a different reply is live on Google; cancelled as provider truth',
  )
}

/**
 * Classify a failed read like a failed write, with one difference: a read
 * proves nothing was written, so everything that is not a refusal is retried,
 * even a failure whose dispatch the provider plane could not tell.
 */
async function handlePrereadFailure(
  deps: PrereadDeps,
  job: Job<PublishReplyJobData>,
  reply: Reply,
  review: Review,
  err: unknown,
): Promise<void> {
  if (refusedForPropertySource(err)) {
    await cancelPublicationCycle(deps, reply, review, 'policy')
    deps.logger.warn(
      'Reply publication refused before sending: its Property is no longer active at the cycle source epoch; cancelled as policy',
    )
    return
  }
  const failure = classifyPublicationFailure(err)
  const attempt = job.attemptsMade + 1
  const fields = {
    attempt,
    failureClass: failure,
    ...publicationFailureEvidence(err),
    ...contentFreeErrorIdentity(err),
  }
  if (failure === 'terminal_rejection') {
    deps.logger.error(
      fields,
      'Reading Google before publishing was refused — marked publish_failed without retry',
    )
    await deps.replyCommandStore.markPublicationTerminal(
      reply,
      'terminal_rejection',
      buildPublishFailedEvent(
        review,
        reply,
        deps.clock(),
        'refused',
        publicationFailureCause(err),
      ),
    )
    return
  }
  deps.logger.error(fields, 'Reading Google before publishing failed (retryable)')
  if (attempt >= MAX_PUBLISH_ATTEMPTS) {
    await deps.replyCommandStore.markPublicationTerminal(
      reply,
      'retryable',
      buildPublishFailedEvent(review, reply, deps.clock(), 'not_sent'),
    )
  }
  throw err
}
