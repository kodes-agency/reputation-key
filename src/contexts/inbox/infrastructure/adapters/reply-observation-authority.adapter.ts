import type { ReviewReplyObservationAuthority } from '#/contexts/review/application/public-api'
import type { ReplyObservationAuthorityPort } from '../../application/ports/reply-observation-authority.port'

/** Translate Review's public authority into the Inbox-owned port. */
export const createReplyObservationAuthorityAdapter = (
  source: ReviewReplyObservationAuthority,
): ReplyObservationAuthorityPort => ({
  withExactCurrent: (expectation, apply) =>
    source.withExactCurrent(expectation, (permit) => apply(permit)),
})
