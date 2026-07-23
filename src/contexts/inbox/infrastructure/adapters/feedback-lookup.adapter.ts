// Inbox context — feedback lookup adapter
// Implements FeedbackLookupPort by delegating to the Guest context's repository.
// Cross-context SQL is encapsulated here in the infrastructure layer where it's acceptable.

import type { FeedbackLookupPort } from '../../application/ports/feedback-lookup.port'
import type { FeedbackLookupSource } from '../../application/ports/lookup-sources.port'

export const createFeedbackLookupAdapter = (
  deps: FeedbackLookupSource,
): FeedbackLookupPort => ({
  getFeedbackSnippetById: async (id, orgId) => {
    const fb = await deps.findFeedbackById(id, orgId)
    if (!fb) return null
    let ratingValue: number | null = null
    if (fb.ratingId) {
      const ratingRow = await deps.findRatingById(fb.ratingId, orgId)
      ratingValue = ratingRow?.value ?? null
    }
    return { comment: fb.comment, ratingValue }
  },
})
