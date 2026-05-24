// Inbox context — review lookup adapter
// Implements ReviewLookupPort by delegating to the Review context's repository.
// Cross-context SQL is encapsulated here in the infrastructure layer where it's acceptable.

import type { ReviewLookupPort } from '../../application/ports/review-lookup.port'
import type { OrganizationId, ReviewId } from '#/shared/domain/ids'

/**
 * Minimal structural type — we only need findById from the review repo.
 * Avoids importing the full ReviewRepository type from another context.
 */
type FindReviewById = (
  id: ReviewId,
  orgId: OrganizationId,
) => Promise<{
  reviewerName: string | null
  text: string | null
  reviewerProfilePhotoUrl: string | null
} | null>

export const createReviewLookupAdapter = (deps: {
  findReviewById: FindReviewById
}): ReviewLookupPort => ({
  getReviewSnippetById: async (id, orgId) => {
    const r = await deps.findReviewById(id, orgId)
    if (!r) return null
    return {
      reviewerName: r.reviewerName,
      text: r.text,
      reviewerProfilePhotoUrl: r.reviewerProfilePhotoUrl,
    }
  },
})
