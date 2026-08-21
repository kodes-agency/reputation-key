import type { ReviewRepository } from '../ports/review.repository'
import type { ReplyRepository } from '../ports/reply.repository'
import type { ReviewId, ReplyId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import {
  defaultReviewLifecycle,
  type Review,
  type GoogleReview,
} from '../../domain/types'
import { reviewCreated, reviewUpdated, reviewReplyPublished } from '../../domain/events'
import {
  calculateExpiresAt,
  computeReviewContentHash,
  MAX_REPLY_LENGTH,
} from '../../domain/rules'
import type { ReviewCommandStore } from '../ports/review-command-store.port'
import type { ReplyCommandStore } from '../ports/reply-command-store.port'
import type { ReviewProviderObservationWriter } from '../ports/review-provider-snapshot.repository'
import { computeAiReviewSourceProvenance } from '../ai-review-source'

export type ReviewProviderObservationWriterDeps = Readonly<{
  reviewRepo: ReviewRepository
  replyRepo: ReplyRepository
  clock: () => Date
  idGen: () => ReviewId
  replyIdGen: () => ReplyId
  commandStore: ReviewCommandStore
  replyCommandStore: ReplyCommandStore
}>

/**
 * Request-scoped Google observation writer used by the provider snapshot
 * orchestrator. It performs no provider I/O and never logs a provider resource.
 * A rejected write throws so the enclosing snapshot page remains
 * non-authoritative; a later page replay safely repeats the idempotent write.
 */
export const createReviewProviderObservationWriter = (
  deps: ReviewProviderObservationWriterDeps,
): ReviewProviderObservationWriter => ({
  persist: async (input) => {
    const now = deps.clock()
    const existing = await deps.reviewRepo.findByExternalId(
      'google',
      input.review.externalId,
      input.organizationId,
    )
    if (
      existing != null &&
      (existing.propertyId !== input.propertyId ||
        existing.sourceEpoch !== input.sourceEpoch)
    ) {
      throw new Error('Review provider observation scope mismatch')
    }

    const contentHash = computeReviewContentHash({
      rating: input.review.rating,
      text: input.review.text,
      reviewerName: input.review.reviewerName,
      languageCode: input.review.languageCode,
    })
    const provenance = computeAiReviewSourceProvenance({
      text: input.review.text,
      rating: input.review.rating,
      languageCode: input.review.languageCode,
      reviewedAtEpochMillis: input.review.reviewedAt.getTime(),
      reviewerDisplayName: input.review.reviewerName,
    })
    const review: Omit<Review, 'createdAt' | 'updatedAt'> = {
      id: existing?.id ?? deps.idGen(),
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      platform: 'google',
      externalId: input.review.externalId,
      externalLocationId: input.review.externalLocationId,
      googleConnectionId: input.connectionId,
      reviewerName: input.review.reviewerName,
      reviewerProfilePhotoUrl: input.review.reviewerProfilePhotoUrl,
      rating: input.review.rating,
      text: input.review.text,
      translatedText: input.review.translatedText,
      languageCode: input.review.languageCode,
      reviewedAt: input.review.reviewedAt,
      expiresAt: calculateExpiresAt(input.review.reviewedAt, now),
      sentimentLabel: existing?.sentimentLabel ?? null,
      sentimentScore: existing?.sentimentScore ?? null,
      ...defaultReviewLifecycle({
        reviewedAt: input.review.reviewedAt,
        now,
        contentHash,
        sourceEpoch: input.sourceEpoch,
        existing: existing ?? null,
        aiSourceByteLength: provenance.byteLength,
        aiSourceDigest: provenance.digest,
      }),
    }
    const expired =
      existing?.contentExpiresAt != null &&
      existing.contentExpiresAt.getTime() <= now.getTime()
    const contentUnchanged =
      existing != null && !expired && existing.aiSourceDigest === review.aiSourceDigest
    const persisted = await persistObservation(deps, review, now, {
      isNew: existing == null,
      contentUnchanged,
      expired,
    })
    await mirrorReply(
      deps,
      persisted.id,
      input.organizationId,
      input.propertyId,
      input.review,
      now,
    )
    return {
      reviewId: persisted.id,
      sourceRevision: persisted.sourceRevision,
      // `existing == null` is the new-vs-seen decision; the snapshot
      // orchestrator turns it into the discovery ladder's activity stamp.
      isNew: existing == null,
    }
  },
})

async function persistObservation(
  deps: ReviewProviderObservationWriterDeps,
  review: Omit<Review, 'createdAt' | 'updatedAt'>,
  now: Date,
  state: Readonly<{
    isNew: boolean
    contentUnchanged: boolean
    expired: boolean
  }>,
): Promise<Review> {
  if (state.expired) return deps.commandStore.reobserveExpiredAndRecord(review, now)
  if (state.contentUnchanged) return deps.reviewRepo.upsert(review, now)
  const eventForReview = (persisted: Review) => {
    const payload = {
      reviewId: persisted.id,
      propertyId: persisted.propertyId,
      organizationId: persisted.organizationId,
      platform: 'google' as const,
      sourceEpoch: persisted.sourceEpoch,
      sourceRevision: persisted.sourceRevision,
      analysisSequence: persisted.analysisSequence,
      occurredAt: now,
    }
    return state.isNew ? reviewCreated(payload) : reviewUpdated(payload)
  }
  return deps.commandStore.upsertAndRecord(review, eventForReview, now)
}

async function mirrorReply(
  deps: ReviewProviderObservationWriterDeps,
  reviewId: ReviewId,
  organizationId: OrganizationId,
  propertyId: PropertyId,
  review: GoogleReview,
  now: Date,
): Promise<void> {
  const existing = await deps.replyRepo.findGoogleSyncByReviewId(reviewId, organizationId)
  if (review.replyText == null) {
    if (existing != null) {
      await deps.replyCommandStore.mirrorSyncedReply({
        reply: null,
        reviewId,
        organizationId,
        event: null,
        now,
      })
    }
    return
  }

  const text = review.replyText.slice(0, MAX_REPLY_LENGTH)
  if (existing != null) {
    await deps.replyCommandStore.mirrorSyncedReply({
      reply: {
        id: existing.id,
        reviewId,
        organizationId,
        text,
        status: existing.status,
        source: 'google_sync',
        createdBy: existing.createdBy,
        approvedBy: existing.approvedBy,
        rejectedBy: existing.rejectedBy,
        rejectionReason: existing.rejectionReason,
        aiGenerated: existing.aiGenerated,
        stateRevision: existing.stateRevision,
        publishedAt: review.replyUpdatedAt ?? existing.publishedAt,
        submittedAt: existing.submittedAt,
        approvedAt: existing.approvedAt,
        publicationState: existing.publicationState,
        publicationAttempts: existing.publicationAttempts,
        publicationLastErrorClass: existing.publicationLastErrorClass,
        reconcileDueAt: existing.reconcileDueAt,
      },
      reviewId,
      organizationId,
      event: null,
      now,
    })
    return
  }

  const newReplyId = deps.replyIdGen()
  await deps.replyCommandStore.mirrorSyncedReply({
    reply: {
      id: newReplyId,
      reviewId,
      organizationId,
      text,
      status: 'published',
      source: 'google_sync',
      createdBy: null,
      approvedBy: null,
      rejectedBy: null,
      rejectionReason: null,
      aiGenerated: false,
      stateRevision: 1,
      submittedAt: null,
      approvedAt: null,
      publishedAt: review.replyUpdatedAt ?? now,
      publicationState: 'published',
      publicationAttempts: 0,
      publicationLastErrorClass: null,
      reconcileDueAt: null,
    },
    reviewId,
    organizationId,
    event: reviewReplyPublished({
      source: 'import',
      authorId: null,
      userId: null,
      replyId: newReplyId,
      reviewId,
      organizationId,
      propertyId,
      occurredAt: now,
    }),
    now,
  })
}
