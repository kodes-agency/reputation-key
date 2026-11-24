// Test-only: a Review with its Reply taken through the real command store to a
// publication stage, on PostgreSQL.

import { replyScopeEffects } from '#/contexts/reputation/public-api'
import { expect } from 'vitest'
import { getDb } from '#/shared/db'
import type { OrganizationId, UserId } from '#/shared/domain/ids'
import { sha256Hex } from '#/shared/domain/sha256'
import type { TestReview } from '#/shared/testing/reputation-fixtures'
import type { Reply, Review } from '../domain/review-types'
import {
  reviewReplyApproved,
  reviewReplyPublicationRequested,
} from '../domain/review-events'
import { createReviewRepository } from '../reviews/review-repository.server'
import { seedReply } from './reply-seed.test-fixtures'
import { createAtomicReplyCommandStore } from './reply-command-store.server'

/** Identity behavior is outside the Review truth-chain fixtures. Production
 * composition injects the real transaction-bound authority; these tests grant
 * their one explicitly seeded manager. */
export const createTestReplyCommandStore = () =>
  createAtomicReplyCommandStore(
    getDb(),
    () => new Date(),
    async () => true,
    replyScopeEffects,
  )

/** How far the first publication cycle is taken: authorized by a manager,
 * claimed for sending, or accepted by the provider and awaiting observation. */
export type PublicationStage = 'authorized' | 'sending' | 'pending_observation'

export async function seedReviewAndReplyAtStage(
  input: Readonly<{
    organizationId: OrganizationId
    userId: UserId
    now: Date
    review: TestReview
    reply: Reply
    stage: PublicationStage
  }>,
): Promise<{ review: Review; reply: Reply }> {
  const { organizationId, userId, now, stage } = input
  const db = getDb()
  const reviewId = input.review.id
  const replyId = input.reply.id
  const propertyId = input.review.propertyId
  const review = await createReviewRepository(
    db,
    () => new Date(),
    undefined,
    replyScopeEffects,
  ).upsert(input.review, now, sha256Hex(`review-observation:${reviewId}`))
  const commandStore = createTestReplyCommandStore()
  const originalReply = await seedReply(db, input.reply)
  const authorized = await commandStore.markPublicationAuthorized(
    originalReply,
    { status: 'approved', approvedBy: userId, approvedAt: now },
    {
      lifecycleEvent: reviewReplyApproved({
        replyId,
        reviewId,
        propertyId,
        organizationId,
        userId,
        authorId: userId,
        occurredAt: now,
      }),
      publicationIntent: reviewReplyPublicationRequested({
        replyId,
        reviewId,
        propertyId,
        organizationId,
        userId,
        publicationCycle: 1,
        sourceEpoch: review.sourceEpoch,
        materialReviewRevision: review.sourceRevision,
        baseObservationRevision: 0,
        occurredAt: now,
      }),
    },
    now,
  )
  expect(authorized).not.toBeNull()
  if (stage === 'authorized') return { review, reply: authorized! }

  const claimed = await commandStore.markPublicationSending(
    authorized!,
    {
      providerOperationKey: `publish:${replyId}:1:1`,
      propertyId,
      sourceEpoch: review.sourceEpoch,
      materialReviewRevision: review.sourceRevision,
      baseObservationRevision: 0,
    },
    now,
  )
  expect(claimed).not.toBeNull()
  if (stage === 'sending') return { review, reply: claimed! }
  const pending = await commandStore.markProviderOutcomePendingObservation(
    claimed!,
    { providerCorrelationId: 'provider-correlation-1', providerRespondedAt: now },
    now,
  )
  expect(pending?.publicationState).toBe('pending_observation')
  return { review, reply: pending! }
}
