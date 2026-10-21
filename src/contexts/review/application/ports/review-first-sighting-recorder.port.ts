// Review context — pairing a Google push with a Review's first-sighting row.
//
// The row itself is written by the Review writer in the Review's first insert
// (review-command-store.port.ts). This port covers the other direction: a
// push read that finds the Review already stored, because polling saw it
// first, stamps the push's acceptance time on the row so the push can be told
// from a missed one.
//
// Content-free: UUIDs and an instant.

import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'

export type ReviewFirstSightingRecorder = Readonly<{
  /**
   * Record that Pub/Sub accepted a push for this Review at `acceptedAt`.
   * The first acceptance time wins (a replayed or second push never moves it),
   * and a Review with no first-sighting row (seen before the ledger, or first
   * seen as history) is left alone.
   */
  markPushArrived(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      reviewId: ReviewId
      acceptedAt: Date
    }>,
  ): Promise<void>
}>
