import type { ReviewGoogleReviewCheck } from '#/contexts/reputation/public-api'
import type { GoogleReviewCheckPort } from './google-review-check.port.server'

/**
 * Translate Review's public "read this review from Google" capability into the
 * Inbox-owned port. Lazy, so a context built with an unbound source (tests
 * build it with `{}` casts) fails only if the capability is actually used.
 */
export const createGoogleReviewCheckAdapter = (
  source: ReviewGoogleReviewCheck,
): GoogleReviewCheckPort => ({
  check: (request) => source(request),
})
