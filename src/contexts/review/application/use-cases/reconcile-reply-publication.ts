// Review context — reconcile ambiguous reply publication (BQC-3.3).
//
// Operator/manual recovery for a reply stuck in publish_failed after an
// AMBIGUOUS publish outcome (timeout/unknown error after the provider request
// may have landed — see classifyPublicationFailure in the publication saga).
//
// The flow re-reads provider state through the SAME GBP read path the review
// sync uses (GoogleReviewApiPort.fetchReviews for the review's location):
// - provider shows a reply for the review → markPublished atomically (heals
//   the divergence; commits the durable review.reply.published fact);
// - provider does not → the reply stays publish_failed; outcome 'still_failed'
//   (the operator may retry publishing via retryPublish).
//
// This use case NEVER calls the publish endpoint. The GBP reply update is an
// UPSERT (exactly one reply per review), so even a racing publish job cannot
// create a duplicate Google-visible reply — reconciliation only acknowledges
// what the provider already shows. It never auto-publishes.

import type { ReplyRepository } from '../ports/reply.repository'
import type { ReviewRepository } from '../ports/review.repository'
import type { GoogleReviewApiPort } from '../ports/google-review-api.port'
import type { ReplyCommandStore } from '../ports/reply-command-store.port'
import type { ReplyId, OrganizationId, GoogleConnectionId } from '#/shared/domain/ids'
import type { ReviewError } from '../../domain/errors'
import { reviewError } from '../../domain/errors'
import { transitionReply } from '../../domain/rules'
import { reviewReplyPublished } from '../../domain/events'
import { ok, err, type Result } from '#/shared/domain'

export type ReconcileReplyPublicationDeps = Readonly<{
  replyRepo: ReplyRepository
  reviewRepo: ReviewRepository
  googleReviewApi: GoogleReviewApiPort
  commandStore: ReplyCommandStore
  clock: () => Date
}>

export type ReconcileReplyPublicationInput = Readonly<{
  replyId: ReplyId
  organizationId: OrganizationId
}>

export type ReconcilePublicationOutcome = Readonly<{
  outcome: 'published' | 'still_failed'
}>

export const reconcileReplyPublication =
  (deps: ReconcileReplyPublicationDeps) =>
  async (
    input: ReconcileReplyPublicationInput,
  ): Promise<Result<ReconcilePublicationOutcome, ReviewError>> => {
    const reply = await deps.replyRepo.findById(input.replyId, input.organizationId)
    if (!reply) {
      return err(reviewError('reply_not_found', 'Reply not found'))
    }
    if (reply.status !== 'publish_failed') {
      return err(
        reviewError(
          'invalid_transition',
          'Only publish_failed replies need publication reconciliation',
        ),
      )
    }

    const review = await deps.reviewRepo.findById(reply.reviewId, input.organizationId)
    if (!review) {
      return err(reviewError('review_not_found', 'Review not found for reply'))
    }
    if (!review.googleConnectionId) {
      // Cannot re-read provider state without a connection — stay honest.
      return ok({ outcome: 'still_failed' })
    }

    const providerHasReply = await fetchProviderReplyState(
      deps,
      input.organizationId,
      review.googleConnectionId,
      review.externalLocationId,
      review.externalId,
    )
    if (providerHasReply.isErr()) return err(providerHasReply.error)
    if (!providerHasReply.value) return ok({ outcome: 'still_failed' })

    // Provider shows the reply → heal the divergence. publish_failed →
    // published is valid only on this path (see REPLY_TRANSITIONS note).
    const now = deps.clock()
    const transitioned = transitionReply(reply, 'published', now)
    if (transitioned.isErr()) return err(transitioned.error)
    const published = await deps.commandStore.markPublished(
      reply,
      { status: 'published', publishedAt: now },
      reviewReplyPublished({
        replyId: reply.id,
        reviewId: reply.reviewId,
        propertyId: review.propertyId,
        organizationId: reply.organizationId,
        userId: null,
        authorId: reply.createdBy,
        occurredAt: now,
      }),
      now,
    )
    if (!published) {
      return err(reviewError('invalid_transition', 'Reply status changed concurrently'))
    }
    return ok({ outcome: 'published' })
  }

export type ReconcileReplyPublication = ReturnType<typeof reconcileReplyPublication>

/** True when the provider currently shows a reply for this review. */
async function fetchProviderReplyState(
  deps: ReconcileReplyPublicationDeps,
  organizationId: OrganizationId,
  connectionId: GoogleConnectionId,
  locationName: string,
  externalId: string,
): Promise<Result<boolean, ReviewError>> {
  let googleReviews
  try {
    googleReviews = await deps.googleReviewApi.fetchReviews(
      organizationId,
      connectionId,
      locationName,
    )
  } catch (e: unknown) {
    return err(
      reviewError('sync_failed', 'Failed to re-read provider reply state', {
        cause: e instanceof Error ? e.message : String(e),
      }),
    )
  }
  const match = googleReviews.find((gr) => gr.externalId === externalId)
  return ok(match?.replyText != null && match.replyText.length > 0)
}
