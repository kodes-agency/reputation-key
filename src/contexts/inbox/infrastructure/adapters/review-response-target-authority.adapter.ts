import type { ReviewResponseTargetAuthority } from '#/contexts/review/application/public-api'
import type { ReviewResponseTargetAuthorityPort } from '../../application/ports/review-response-target-authority.port'

/** Translate Review's public authority into the Inbox-owned port. */
export const createReviewResponseTargetAuthorityAdapter = (
  source: ReviewResponseTargetAuthority,
): ReviewResponseTargetAuthorityPort => ({
  withExactCurrent: (expectation, apply) =>
    source.withExactCurrent(expectation, (permit) => apply(permit)),
  withExactCurrentBatch: (expectations, apply) =>
    source.withExactCurrentBatch(expectations, (permits) => apply(permits)),
  withInboxProjection: (expectation, apply) =>
    source.withInboxProjection(expectation, (permit) => apply(permit)),
})
