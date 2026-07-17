// Metric context — review rating lookup adapter (BQC-1.2).
// Thin structural adapter over the review repository; eligibility rule is
// shared with every other read via isContentEligibleForRead (ADR 0031).

import type { ReviewRatingLookupPort } from '../../application/ports/review-rating-lookup.port'
import type { OrganizationId, ReviewId } from '#/shared/domain/ids'
import { isContentEligibleForRead } from '#/contexts/review/application/source-content-lifecycle'

type RatingRow = Readonly<{
  rating: number | null
  contentExpiresAt: Date | null
}>

export const createReviewRatingLookupAdapter = (deps: {
  findReviewById: (id: ReviewId, orgId: OrganizationId) => Promise<RatingRow | null>
  clock: () => Date
}): ReviewRatingLookupPort => ({
  getEligibleRatingById: async (id, orgId) => {
    const r = await deps.findReviewById(id, orgId)
    if (!r || !isContentEligibleForRead(r.contentExpiresAt, deps.clock())) return null
    return r.rating
  },
})
