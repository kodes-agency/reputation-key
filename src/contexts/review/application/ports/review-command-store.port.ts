// Review command store — atomic business write + outbox record (BQR-2.3).
//
// Callers must not know Drizzle transaction types or outbox tables.
// Production implementation commits review upsert + outbox_events row in one
// PostgreSQL transaction, then emits on the in-process bus after commit
// (expand-phase dual path until durable switch).

import type { DomainEvent } from '#/shared/events/events'
import type { Review } from '../../domain/types'
import type { ReviewProviderObservationOrigin } from './response-target-authority.port'

export type ReviewCommandStore = Readonly<{
  /**
   * Persist the review and its domain event's outbox row together, then
   * deliver the event on the in-process bus after the transaction commits.
   */
  upsertAndRecord(
    review: Omit<Review, 'createdAt' | 'updatedAt'>,
    event: DomainEvent | ((persisted: Review) => DomainEvent),
    now?: Date,
    observationKey?: string,
    observationOrigin?: ReviewProviderObservationOrigin,
  ): Promise<Review>
  /**
   * At the database expiry equality boundary, atomically emit the old source
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
