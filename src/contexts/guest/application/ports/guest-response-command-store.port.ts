import type {
  GuestFeedbackRetracted,
  GuestFeedbackSubmitted,
  GuestRatingRetracted,
  GuestRatingSubmitted,
} from '../../domain/events'
import type { GuestResponse } from '../../domain/guest-response'

/** Content-minimal facts committed with a submitted Guest Response. */
export type GuestSubmissionFact = GuestRatingSubmitted | GuestFeedbackSubmitted
export type GuestMutationFact =
  GuestSubmissionFact | GuestRatingRetracted | GuestFeedbackRetracted

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
  /** Compare-and-set the one permitted correction and its replacement facts. */
  commitCorrected(
    previous: GuestResponse,
    response: GuestResponse,
    facts: ReadonlyArray<GuestMutationFact>,
  ): Promise<'applied' | 'conflict'>
  /** Add the one eligible private-feedback fact without consuming rating correction. */
  commitFeedbackAdded(
    response: GuestResponse,
    fact: GuestFeedbackSubmitted,
  ): Promise<'applied' | 'conflict'>
  /** Withdraw content, queue media purge, and retract every effective fact atomically. */
  commitWithdrawn(
    response: GuestResponse,
    facts: ReadonlyArray<GuestMutationFact>,
  ): Promise<
    | Readonly<{ outcome: 'applied'; objectKeys: readonly string[] }>
    | Readonly<{ outcome: 'conflict'; objectKeys: readonly [] }>
  >
}>
