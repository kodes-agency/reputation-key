import type { ReviewSourceTransitionAuthority } from '#/contexts/review/application/public-api'
import type { SourceTransitionAuthorityPort } from '../../application/ports/source-transition-authority.port'

/** Translate Review's public exact-current authority into Inbox's owned port. */
export const createSourceTransitionAuthorityAdapter = (
  source: ReviewSourceTransitionAuthority,
): SourceTransitionAuthorityPort => ({
  withExactCurrent: (expectation, apply) =>
    source.withExactCurrent(expectation, (permit) => apply(permit)),
})
