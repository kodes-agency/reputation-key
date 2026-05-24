// Inbox context — feedback lookup adapter
// Implements FeedbackLookupPort by delegating to the Guest context's repository.
// Cross-context SQL is encapsulated here in the infrastructure layer where it's acceptable.

import type { FeedbackLookupPort } from '../../application/ports/feedback-lookup.port'
import type { FeedbackId, OrganizationId, RatingId } from '#/shared/domain/ids'

/**
 * Minimal structural types — only what we need from the guest repo.
 * Avoids importing the full GuestInteractionRepository type from another context.
 */
type FeedbackRow = { comment: string; ratingId: RatingId | null }
type RatingRow = { value: number }

type GuestRepoDeps = Readonly<{
  findFeedbackById: (id: FeedbackId, orgId: OrganizationId) => Promise<FeedbackRow | null>
  findRatingById: (id: RatingId, orgId: OrganizationId) => Promise<RatingRow | null>
}>

export const createFeedbackLookupAdapter = (deps: GuestRepoDeps): FeedbackLookupPort => ({
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
