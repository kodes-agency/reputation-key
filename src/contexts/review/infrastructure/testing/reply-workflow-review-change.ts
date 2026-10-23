// Test-only: the review sync that finds a change to the workflow's Review, for
// the reply workflow harness (reply-workflow-harness.ts).

import { sha256Hex } from '#/shared/domain/sha256'
import type { Review } from '../../domain/types'
import { reviewUpdated } from '../../domain/events'
import type { ReviewCommandStore } from '../../application/ports/review-command-store.port'
import type { ReviewRepository } from '../../application/ports/review.repository'

export type ReviewChange = Partial<Pick<Review, 'rating' | 'text' | 'reviewerName'>>

/**
 * A review sync that reads the Review with `change` applied and records it
 * through the store sync uses for a Review whose content differs, with its
 * `review.updated` fact. A changed rating or text is a guest edit: Review
 * records the next Material Review Revision. Anything else is the same
 * revision observed again.
 *
 * A guest edit moves Google's updateTime, and the same difference at an
 * unmoved one is Google rewording the review, which keeps the revision
 * (`provider_restatement`). The clock stands still unless a test advances it,
 * so a second edit would land on the first one's updateTime: the time of this
 * one is the clock or a millisecond past the stored one, whichever is later.
 */
export function createReviewChangeObserver(
  deps: Readonly<{
    reviewRepo: Pick<ReviewRepository, 'findById'>
    reviewCommandStore: ReviewCommandStore
    clock: () => Date
    /** The Review as the first sync stored it. */
    seed: () => Omit<Review, 'createdAt' | 'updatedAt'>
  }>,
): (change: ReviewChange) => Promise<Review> {
  return async (change) => {
    const seed = deps.seed()
    const observedAt = deps.clock()
    const stored = await deps.reviewRepo.findById(seed.id, seed.organizationId)
    const editedAt = new Date(
      Math.max(
        observedAt.getTime(),
        (stored?.sourceUpdatedAt?.getTime() ?? -Infinity) + 1,
      ),
    )
    return deps.reviewCommandStore.upsertAndRecord(
      { ...seed, ...change, sourceUpdatedAt: editedAt, lastFetchedAt: observedAt },
      (review) =>
        reviewUpdated({
          reviewId: review.id,
          organizationId: seed.organizationId,
          propertyId: seed.propertyId,
          platform: 'google',
          sourceEpoch: review.sourceEpoch,
          sourceRevision: review.sourceRevision,
          analysisSequence: review.analysisSequence,
          occurredAt: observedAt,
        }),
      observedAt,
      sha256Hex(`reply-workflow-review-change:${JSON.stringify(change)}`),
      'ongoing',
    )
  }
}
