import type { InboxCommandAuthority } from '#/contexts/reputation/inbox/command-store.server'
import type {
  ReviewLookupPort,
  ReviewSnippetResult,
} from '#/contexts/reputation/inbox/review-lookup.port.server'
import type { FeedbackLookupPort } from '#/contexts/reputation/inbox/feedback-lookup.port.server'
import { inertPropertyLookup } from '#/contexts/reputation/inbox/inert-property-lookup.test-fixtures'

export const allowAllCommandAuthority: InboxCommandAuthority = async () => ({
  allowed: true,
})

/**
 * Lookups that know nothing of other contexts: no review, no feedback, no Property.
 * A test that needs one method to answer spreads the lookup and overrides it.
 */
export const emptyLookupPorts = {
  reviewLookup: {
    getReviewSnippetById: async (): Promise<ReviewSnippetResult> => ({
      status: 'not_found',
    }),
    getReviewSnippetsByIds: async () => new Map(),
    findEligibleReviewIds: async () => [] as string[],
  } satisfies ReviewLookupPort,
  feedbackLookup: {
    getFeedbackSnippetById: async () => null,
    getFeedbackSnippetsByIds: async () => new Map(),
    findEligibleFeedbackIds: async () => [],
  } satisfies FeedbackLookupPort,
  propertyLookup: inertPropertyLookup,
}
