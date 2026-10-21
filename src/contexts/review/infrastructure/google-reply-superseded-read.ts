// Review context — what a reply observation does when a newer provider read has
// already moved the Review's reply head.
//
// Reads are ordered by a generation allocated after the provider response. A
// read whose generation is not above the head's was overtaken by a newer one.
//
// A SYNC read (a snapshot page, a push fetch, a pre-publish read, a head check:
// every `provider_snapshot` observation) only reports what Google showed at one
// moment. Being overtaken is normal there, since a head check and a snapshot
// page can read the same review concurrently, and the newer truth is already
// stored. It is a silent no-op: the result restates the head, nothing is
// written, and the caller's page or check carries on instead of failing.
//
// A TARGETED read (`targeted_reconciliation`: the publication reconciler and the
// publish read-back) decides what became of a reply attempt. Its outcome mapping
// depends on being told the read was superseded, so it still throws.

import type {
  GoogleReplyObservationResult,
  RecordGoogleReplyObservation,
} from '../application/ports/google-reply-observation-store.port'
import { reviewError } from '../domain/errors'

/** The result of an overtaken sync read: the head as it stands, unchanged. */
export function resolveSupersededReplyRead(
  input: Pick<RecordGoogleReplyObservation, 'source'>,
  head: Readonly<{ observationRevision: number }>,
): GoogleReplyObservationResult {
  if (input.source !== 'provider_snapshot') {
    throw reviewError(
      'invalid_transition',
      'Google reply observation was superseded by a newer provider read',
    )
  }
  return {
    observationRevision: head.observationRevision,
    change: 'unchanged',
    resolution: 'unchanged',
    matchedReplyId: null,
    matchedPublicationCycle: null,
    duplicate: true,
  }
}
