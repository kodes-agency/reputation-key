// Consumed event families that no production code emits, and why.
//
// event-job-catalogue.test.ts requires every family with durable consumers in
// event-job-catalogue.ts to have a production producer or an entry here, and
// fails on an entry whose family gained a producer or lost its consumers.

/**
 * - 'legacy_replay': its producer was retired; facts recorded before that are
 *   still delivered and replayed, so the consumers stay.
 * - 'reserved': defined and consumed ahead of the command that will emit it.
 */
export type ProducerlessReason = 'legacy_replay' | 'reserved'

export const PRODUCERLESS_EVENT_FAMILIES: Readonly<Record<string, ProducerlessReason>> =
  Object.freeze({
    // review.source_transitioned replaced it and nothing emits it now; a
    // restored or still-pending fact converges on the same Inbox command.
    'review.expired': 'legacy_replay',
    // Property deletion fails closed in the beta (property CONTEXT.md), so
    // nothing emits it; recorded facts are still delivered.
    'property.deleted': 'legacy_replay',
    // The Qualified Scan correction path (guest CONTEXT.md): the store write
    // and this fact exist, but no use case retracts a scan yet.
    'guest.qualified_scan.retracted': 'reserved',
  })
