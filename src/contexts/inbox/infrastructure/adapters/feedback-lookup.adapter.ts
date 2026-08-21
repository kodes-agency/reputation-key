// Inbox context — feedback lookup adapter
// Implements FeedbackLookupPort by delegating to the Guest context's repository.
// Cross-context SQL is encapsulated here in the infrastructure layer where it's acceptable.
//
// Reads the CURRENT guest_responses aggregate first and only then the legacy
// feedback/ratings pair. The live guest form writes the aggregate, and
// `guest.feedback.submitted` now carries the aggregate row id — without this
// order every new feedback inbox item would render with a null comment and a
// null rating, because the legacy lookup cannot find that id.

import type { FeedbackLookupPort } from '../../application/ports/feedback-lookup.port'
import type { FeedbackLookupSource } from '../../application/ports/lookup-sources.port'

export const createFeedbackLookupAdapter = (
  deps: FeedbackLookupSource,
): FeedbackLookupPort => ({
  getFeedbackSnippetById: async (id, orgId) => {
    const response = await deps.findResponseSnippetById(id, orgId)
    if (response) return response

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
