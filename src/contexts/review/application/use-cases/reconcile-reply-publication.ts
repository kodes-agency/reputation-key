// Targeted Google reply reconciliation. This path never publishes. A provider
// read is recorded through the single observation authority, which alone may
// confirm an exact current attempted reply as published.

import type { ReplyRepository } from '../ports/reply.repository'
import type { ReviewRepository } from '../ports/review.repository'
import type { GoogleReviewApiPort } from '../ports/google-review-api.port'
import type { GoogleReplyObservationStore } from '../ports/google-reply-observation-store.port'
import type { OrganizationId, ReplyId } from '#/shared/domain/ids'
import type { ReviewError } from '../../domain/errors'
import { reviewError } from '../../domain/errors'
import { ok, err, type Result } from '#/shared/domain'
import { sha256Hex } from '#/shared/domain/sha256'
import { contentExpiresAtFromFetch } from '#/shared/domain/source-content-policy'
import { googleReplyTextDigest } from '../../domain/google-reply-observation'

export type ReconcileReplyPublicationDeps = Readonly<{
  replyRepo: ReplyRepository
  reviewRepo: ReviewRepository
  googleReviewApi: GoogleReviewApiPort
  observationStore: GoogleReplyObservationStore
  clock: () => Date
}>

export type ReconcileReplyPublicationInput = Readonly<{
  replyId: ReplyId
  organizationId: OrganizationId
}>

export type ReconcilePublicationOutcome = Readonly<{
  outcome:
    | 'confirmed_on_google'
    | 'external_current_live'
    | 'diverged'
    | 'absent'
    | 'provider_review_missing'
}>

function isReconciliableReply(status: string, publicationState: string | null): boolean {
  return (
    (status === 'approved' &&
      (publicationState === 'sending' || publicationState === 'pending_observation')) ||
    (status === 'publish_failed' &&
      (publicationState === 'ambiguous' || publicationState === 'terminal'))
  )
}

export const reconcileReplyPublication =
  (deps: ReconcileReplyPublicationDeps) =>
  async (
    input: ReconcileReplyPublicationInput,
  ): Promise<Result<ReconcilePublicationOutcome, ReviewError>> => {
    const reply = await deps.replyRepo.findById(input.replyId, input.organizationId)
    if (!reply) return err(reviewError('reply_not_found', 'Reply not found'))
    if (!isReconciliableReply(reply.status, reply.publicationState)) {
      return err(
        reviewError(
          'invalid_transition',
          'Only provider-pending or uncertain replies need publication reconciliation',
        ),
      )
    }
    if (reply.publicationCycle < 1 || reply.publicationAttempts < 1) {
      return err(
        reviewError(
          'invalid_transition',
          'Publication reconciliation requires an exact provider attempt',
        ),
      )
    }

    const review = await deps.reviewRepo.findById(reply.reviewId, input.organizationId)
    if (!review) {
      return err(reviewError('review_not_found', 'Review not found for reply'))
    }
    if (!review.googleConnectionId || !review.externalLocationId || !review.externalId) {
      return ok({ outcome: 'provider_review_missing' })
    }

    let result
    try {
      result = await deps.googleReviewApi.getReview({
        organizationId: input.organizationId,
        propertyId: review.propertyId,
        connectionId: review.googleConnectionId,
        sourceEpoch: review.sourceEpoch,
        locationName: review.externalLocationId,
        reviewName: `${review.externalLocationId}/reviews/${review.externalId}`,
      })
    } catch (cause: unknown) {
      return err(
        reviewError('sync_failed', 'Failed to re-read provider reply state', {
          cause: cause instanceof Error ? cause.message : String(cause),
        }),
      )
    }
    // A 404 for the Review is source-lifecycle evidence, not proof that the
    // reply alone is absent. Do not synthesize a deletion observation here.
    if (result.status === 'not_found') {
      return ok({ outcome: 'provider_review_missing' })
    }

    // Generations order acquired provider responses, not request starts. A
    // slower earlier request must therefore allocate only after its response
    // arrives, so it cannot overwrite truth acquired by a later request.
    const readGeneration = await deps.observationStore.allocateReadGeneration()
    const observedAt = deps.clock()

    const observation = await deps.observationStore.record({
      organizationId: input.organizationId,
      propertyId: review.propertyId,
      reviewId: review.id,
      sourceEpoch: review.sourceEpoch,
      materialReviewRevision: review.sourceRevision,
      observationKey: sha256Hex(
        [
          'targeted-reply-reconciliation-v1',
          `review:${String(review.id)}`,
          `publication-cycle:${String(reply.publicationCycle)}`,
          `source-epoch:${String(review.sourceEpoch)}`,
          `material-review-revision:${String(review.sourceRevision)}`,
          `attempt:${String(reply.publicationAttempts)}`,
          `read-generation:${String(readGeneration)}`,
          `provider-updated-at:${result.review.replyUpdatedAt?.toISOString() ?? 'absent'}`,
          result.review.replyText === null
            ? 'reply-state:absent'
            : `reply-state:live:${googleReplyTextDigest(result.review.replyText)}`,
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

    const outcome =
      observation.resolution === 'unchanged'
        ? result.review.replyText === null
          ? ('absent' as const)
          : ('external_current_live' as const)
        : observation.resolution
    return ok({ outcome })
  }

export type ReconcileReplyPublication = ReturnType<typeof reconcileReplyPublication>
