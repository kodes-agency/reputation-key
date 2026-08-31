import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  materialReviewRevisions,
  googleReplyObservations,
  replies,
  reviews,
  reviewSourceContents,
  reviewSourceObservations,
} from '#/shared/db/schema/review.schema'
import { unbrand } from '#/shared/domain/ids'
import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import type { Tx } from '#/shared/outbox/commit'
import type { Review } from '../domain/types'

type ReviewSourceContentWriter = Pick<Database, 'insert'>

/**
 * REV-01 expand writer.
 *
 * The independently erasable row and the legacy Review compatibility cache
 * are written in the caller's transaction. Keeping this function at the
 * infrastructure boundary prevents command paths from inventing a second
 * mapping or forgetting a provider-controlled field.
 */
export async function upsertReviewSourceContent(
  writer: ReviewSourceContentWriter,
  review: Omit<Review, 'createdAt' | 'updatedAt'>,
): Promise<boolean> {
  if (review.lastFetchedAt == null || review.contentExpiresAt == null) {
    // Expand compatibility: pre-lifecycle fixtures/rows remain writable by
    // generic repository callers, but are deliberately excluded from the new
    // cache instead of inventing fetch clocks. Provider observations always
    // supply both controls and command stores require a successful dual-write.
    return false
  }

  const values = {
    reviewId: unbrand(review.id),
    organizationId: unbrand(review.organizationId),
    propertyId: unbrand(review.propertyId),
    platform: review.platform,
    externalId: review.externalId,
    externalLocationId: review.externalLocationId,
    googleConnectionId:
      review.googleConnectionId == null ? null : unbrand(review.googleConnectionId),
    reviewerName: review.reviewerName,
    reviewerProfilePhotoUrl: review.reviewerProfilePhotoUrl,
    rating: review.rating,
    text: review.text,
    translatedText: review.translatedText,
    languageCode: review.languageCode,
    reviewedAt: review.reviewedAt,
    sourceCreatedAt: review.sourceCreatedAt,
    sourceUpdatedAt: review.sourceUpdatedAt,
    firstFetchedAt: review.firstFetchedAt,
    lastFetchedAt: review.lastFetchedAt,
    contentExpiresAt: review.contentExpiresAt,
    contentHash: review.contentHash,
    sourceEpoch: review.sourceEpoch,
    sourceRevision: review.sourceRevision,
    aiSourceByteLength: review.aiSourceByteLength,
    aiSourceDigest: review.aiSourceDigest,
  }

  await writer
    .insert(reviewSourceContents)
    .values(values)
    .onConflictDoUpdate({
      target: reviewSourceContents.reviewId,
      set: {
        organizationId: values.organizationId,
        propertyId: values.propertyId,
        platform: values.platform,
        externalId: values.externalId,
        externalLocationId: values.externalLocationId,
        googleConnectionId: values.googleConnectionId,
        reviewerName: values.reviewerName,
        reviewerProfilePhotoUrl: values.reviewerProfilePhotoUrl,
        rating: values.rating,
        text: values.text,
        translatedText: values.translatedText,
        languageCode: values.languageCode,
        reviewedAt: values.reviewedAt,
        sourceCreatedAt: values.sourceCreatedAt,
        sourceUpdatedAt: values.sourceUpdatedAt,
        firstFetchedAt: values.firstFetchedAt,
        lastFetchedAt: values.lastFetchedAt,
        contentExpiresAt: values.contentExpiresAt,
        contentHash: values.contentHash,
        sourceEpoch: values.sourceEpoch,
        sourceRevision: values.sourceRevision,
        aiSourceByteLength: values.aiSourceByteLength,
        aiSourceDigest: values.aiSourceDigest,
        updatedAt: sql`transaction_timestamp()`,
      },
    })
  return true
}

/**
 * Atomically turn the compatibility Review row into a content-free tombstone
 * and remove its independently erasable provider cache. The caller owns the
 * surrounding lifecycle transaction and event/outbox write.
 */
export async function eraseReviewSourceContent(
  tx: Tx,
  input: Readonly<{
    reviewId: ReviewId
    organizationId: OrganizationId
    propertyId: PropertyId
    sourceEpoch: number
    expectedSourceRevision: number
    state: 'source_expired' | 'provider_deleted'
  }>,
): Promise<boolean> {
  const rows = await tx
    .update(reviews)
    .set({
      externalId: null,
      externalLocationId: null,
      googleConnectionId: null,
      reviewerName: null,
      reviewerProfilePhotoUrl: null,
      rating: null,
      text: null,
      translatedText: null,
      languageCode: null,
      reviewedAt: null,
      expiresAt: null,
      sourceCreatedAt: null,
      sourceUpdatedAt: null,
      contentHash: null,
      aiSourceByteLength: null,
      aiSourceDigest: null,
      sourceContentState: input.state,
      sourceContentErasedAt: sql`transaction_timestamp()`,
      updatedAt: sql`transaction_timestamp()`,
    })
    .where(
      and(
        eq(reviews.id, input.reviewId),
        eq(reviews.organizationId, input.organizationId),
        eq(reviews.propertyId, input.propertyId),
        eq(reviews.sourceEpoch, input.sourceEpoch),
        eq(reviews.sourceRevision, input.expectedSourceRevision),
      ),
    )
    .returning({ id: reviews.id })
  if (!rows[0]) return false

  // Historical identities and comparison controls remain, but provider-owned
  // values are removed from every retained observation/revision across all
  // historical source epochs. The Review update above fences the current epoch
  // first, so a stale old-epoch command cannot erase a newly rebound Review.
  // Manager-owned Replies, Inbox items, and their audit history are separate
  // records and are intentionally outside this lifecycle operation.
  await tx
    .update(reviewSourceObservations)
    .set({
      rating: null,
      originalText: null,
      translatedText: null,
      languageCode: null,
      reviewerName: null,
      reviewerProfilePhotoUrl: null,
      reviewedAt: null,
      sourceCreatedAt: null,
      sourceUpdatedAt: null,
      contentState: input.state,
      contentErasedAt: sql`transaction_timestamp()`,
      updatedAt: sql`transaction_timestamp()`,
    })
    .where(
      and(
        eq(reviewSourceObservations.reviewId, input.reviewId),
        eq(reviewSourceObservations.organizationId, input.organizationId),
        eq(reviewSourceObservations.propertyId, input.propertyId),
        eq(reviewSourceObservations.contentState, 'active'),
      ),
    )

  await tx
    .update(materialReviewRevisions)
    .set({
      rating: null,
      normalizedText: null,
      contentState: input.state,
      contentErasedAt: sql`transaction_timestamp()`,
      updatedAt: sql`transaction_timestamp()`,
    })
    .where(
      and(
        eq(materialReviewRevisions.reviewId, input.reviewId),
        eq(materialReviewRevisions.organizationId, input.organizationId),
        eq(materialReviewRevisions.propertyId, input.propertyId),
        eq(materialReviewRevisions.contentState, 'active'),
      ),
    )

  await tx
    .update(googleReplyObservations)
    .set({
      normalizedText: null,
      normalizedDigest: null,
      contentState: input.state,
      contentErasedAt: sql`transaction_timestamp()`,
      updatedAt: sql`transaction_timestamp()`,
    })
    .where(
      and(
        eq(googleReplyObservations.reviewId, input.reviewId),
        eq(googleReplyObservations.organizationId, input.organizationId),
        eq(googleReplyObservations.propertyId, input.propertyId),
        eq(googleReplyObservations.contentState, 'active'),
      ),
    )

  // Pre-RPL provider mirrors are provider-owned source content too. Current
  // code no longer creates them; erase any retained compatibility row during
  // the same lifecycle transaction.
  await tx
    .delete(replies)
    .where(
      and(
        eq(replies.reviewId, input.reviewId),
        eq(replies.organizationId, input.organizationId),
        eq(replies.source, 'google_sync'),
      ),
    )

  await tx
    .delete(reviewSourceContents)
    .where(
      and(
        eq(reviewSourceContents.reviewId, input.reviewId),
        eq(reviewSourceContents.organizationId, input.organizationId),
        eq(reviewSourceContents.propertyId, input.propertyId),
      ),
    )
  return true
}
