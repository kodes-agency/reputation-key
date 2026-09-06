import type {
  GuestFeedbackRetracted,
  GuestFeedbackSubmitted,
  GuestRatingRetracted,
  GuestRatingSubmitted,
} from '../../domain/events'
import type { GuestResponse } from '../../domain/guest-response'
import type { GuestResponseIntegrityDecision } from '../../domain/guest-response-integrity'

/** Content-minimal facts committed with a submitted Guest Response. */
export type GuestSubmissionFact = GuestRatingSubmitted | GuestFeedbackSubmitted
export type GuestMutationFact =
  GuestSubmissionFact | GuestRatingRetracted | GuestFeedbackRetracted

export type GuestResponseCommandStore = Readonly<{
  /**
   * Commit the canonical response and every derived submission fact in one
   * transaction. Duplicate means the session/Portal anchor already exists and
   * no new facts are recorded.
   */
  commitSubmitted(
    response: GuestResponse,
    facts: ReadonlyArray<GuestSubmissionFact>,
    /** Required for a non-default automatic assessment; omitted means baseline acceptance. */
    integrityDecision?: GuestResponseIntegrityDecision,
  ): Promise<'applied' | 'duplicate'>
  /** Compare-and-set the one permitted correction and its replacement facts. */
  commitCorrected(
    previous: GuestResponse,
    response: GuestResponse,
    facts: ReadonlyArray<GuestMutationFact>,
  ): Promise<'applied' | 'conflict'>
  /**
   * Compare-and-set a reasoned integrity decision with any rating eligibility
   * correction it causes. The numeric response is never deleted by this path.
   */
  commitIntegrityChanged(
    previous: GuestResponse,
    response: GuestResponse,
    decision: GuestResponseIntegrityDecision,
    facts: ReadonlyArray<GuestMutationFact>,
  ): Promise<'applied' | 'conflict'>
  /** Add the one eligible private-feedback fact without consuming rating correction. */
  commitFeedbackAdded(
    response: GuestResponse,
    fact: GuestFeedbackSubmitted,
  ): Promise<'applied' | 'conflict'>
  /** Purge private feedback while preserving the response's effective rating. */
  commitFeedbackWithdrawn(
    previous: GuestResponse,
    response: GuestResponse,
    fact: GuestFeedbackRetracted,
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
