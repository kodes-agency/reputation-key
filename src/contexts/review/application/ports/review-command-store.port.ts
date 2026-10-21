// Review command store — atomic business write + outbox record (BQR-2.3).
//
// Callers must not know Drizzle transaction types or outbox tables.
// The production implementation commits each Review write with its
// outbox_events rows in one PostgreSQL transaction.

import type { DomainEvent } from '#/shared/events/events'
import type { Review } from '../../domain/types'
import type { ReviewFirstSeenVia } from '#/shared/domain/push-health'
import type { ReviewProviderObservationOrigin } from './response-target-authority.port'

/**
 * How a live (`ongoing`) first sighting was made, for the push health ledger.
 * Present only on a write that is a Review's first insert; recorded with it,
 * in the same transaction, when that insert turns out to be the Review's
 * `review.created`.
 */
export type ReviewFirstSighting = Readonly<{
  seenVia: ReviewFirstSeenVia
  /** When Pub/Sub accepted Google's push for the Review; null when none is paired. */
  pushAcceptedAt: Date | null
}>

export type ReviewCommandStore = Readonly<{
  /** Persist the Review and its domain fact's outbox row together. */
  upsertAndRecord(
    review: Omit<Review, 'createdAt' | 'updatedAt'>,
    event: DomainEvent | ((persisted: Review) => DomainEvent),
    now?: Date,
    observationKey?: string,
    observationOrigin?: ReviewProviderObservationOrigin,
    firstSighting?: ReviewFirstSighting,
  ): Promise<Review>
  /**
   * At the database expiry equality boundary, atomically record the old source
   * expiry and restore the same durable Review identity from a fresh
   * observation. The revision advances for a material change or source-epoch
   * carry so prior exact bindings stay immutable; dependent staff records
   * remain attached to the Review identity.
   */
  reobserveExpiredAndRecord(
    review: Omit<Review, 'createdAt' | 'updatedAt'>,
    now?: Date,
    observationKey?: string,
    observationOrigin?: ReviewProviderObservationOrigin,
  ): Promise<Review>
}>
