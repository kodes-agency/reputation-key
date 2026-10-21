import type { ReviewGoogleReviewCheck } from '#/contexts/review/application/public-api'
import type { GoogleReviewCheckPort } from '../../application/ports/google-review-check.port'

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
