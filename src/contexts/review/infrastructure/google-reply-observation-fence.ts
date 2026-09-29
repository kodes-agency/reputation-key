// The payload fence a Google reply observation must pass before the store
// takes any lock. It checks the command alone, never stored state, so it
// lives apart from the transaction that records the observation.

import type { RecordGoogleReplyObservation } from '../application/ports/google-reply-observation-store.port'
import { reviewError } from '../domain/errors'

/** Payload fence for one observation command: a well-formed idempotency key,
 * usable clocks, an expiry after the observation, in-range source counters, and
 * — for a targeted read — a complete publication target. */
export function assertObservationFence(input: RecordGoogleReplyObservation): void {
  if (
    !/^[0-9a-f]{64}$/u.test(input.observationKey) ||
    Number.isNaN(input.observedAt.getTime()) ||
    Number.isNaN(input.contentExpiresAt.getTime()) ||
    (input.providerUpdatedAt !== null &&
      Number.isNaN(input.providerUpdatedAt.getTime())) ||
    input.contentExpiresAt.getTime() <= input.observedAt.getTime() ||
    input.materialReviewRevision < 1 ||
    !Number.isSafeInteger(input.materialReviewRevision) ||
    input.readGeneration < 1 ||
    !Number.isSafeInteger(input.readGeneration) ||
    input.sourceEpoch < 0 ||
    !Number.isSafeInteger(input.sourceEpoch) ||
    (input.source === 'targeted_reconciliation' &&
      (String(input.publicationTarget.replyId).length === 0 ||
        input.publicationTarget.publicationCycle < 1 ||
        !Number.isSafeInteger(input.publicationTarget.publicationCycle) ||
        input.publicationTarget.attemptNumber < 1 ||
        !Number.isSafeInteger(input.publicationTarget.attemptNumber)))
  ) {
    throw reviewError('invalid_input', 'Invalid Google reply observation fence')
  }
}
