import type { GuestFeedbackSubmitted, GuestRatingSubmitted } from '../../domain/events'
import type { GuestResponse } from '../../domain/guest-response'

/** Content-minimal facts committed with a submitted Guest Response. */
export type GuestSubmissionFact = GuestRatingSubmitted | GuestFeedbackSubmitted

export type GuestResponseCommandStore = Readonly<{
  /**
   * Commit the canonical response and every derived submission fact in one
   * transaction. Duplicate means the session/Portal anchor already exists;
   * no new facts are written or emitted in that case.
   */
  commitSubmitted(
    response: GuestResponse,
    facts: ReadonlyArray<GuestSubmissionFact>,
  ): Promise<'applied' | 'duplicate'>
}>
