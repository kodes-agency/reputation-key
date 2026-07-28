// Atomic review command store (BQR-2.3).
//
// One PostgreSQL transaction: reviews upsert + outbox_events insert.
// After commit: in-process EventBus emit for expand-phase legacy consumers.
// Crash after commit but before emit leaves a durable outbox row for relay.

import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { emitAfterCommit, insertOutboxRow } from '#/shared/outbox/commit'
import { reviews } from '#/shared/db/schema/review.schema'
import { trace } from '#/shared/observability/trace'
import type { Review } from '../domain/types'
import { reviewError } from '../domain/errors'
import { reviewFromRow, reviewToRow } from './mappers/review.mapper'
import type { ReviewCommandStore } from '../application/ports/review-command-store.port'

export function createAtomicReviewCommandStore(
  db: Database,
  events: EventBus,
): ReviewCommandStore {
  return {
    upsertAndRecord: async (review, event, now) => {
      return trace('review.commandStore.upsertAndRecord', async () => {
        const saved = await db.transaction(async (tx) => {
          const row = reviewToRow(review)
          const updatedAt = now ?? new Date()
          const result = await tx
            .insert(reviews)
            .values(row)
            .onConflictDoUpdate({
              target: [reviews.platform, reviews.externalId, reviews.organizationId],
              set: {
                propertyId: row.propertyId,
                externalLocationId: row.externalLocationId,
                googleConnectionId: row.googleConnectionId,
                reviewerName: row.reviewerName,
                reviewerProfilePhotoUrl: row.reviewerProfilePhotoUrl,
                rating: row.rating,
                text: row.text,
                languageCode: row.languageCode,
                reviewedAt: row.reviewedAt,
                expiresAt: row.expiresAt,
                lastFetchedAt: row.lastFetchedAt,
                sourceCreatedAt: row.sourceCreatedAt,
                sourceUpdatedAt: row.sourceUpdatedAt,
                firstFetchedAt: row.firstFetchedAt,
                contentExpiresAt: row.contentExpiresAt,
                contentHash: row.contentHash,
                sourceSeenGeneration: row.sourceSeenGeneration,
                updatedAt,
              },
            })
            .returning()

          if (!result[0]) {
            throw reviewError(
              'repo_upsert_failed',
              'Review upsert failed — no row returned',
            )
          }

          await insertOutboxRow(tx, event)

          return reviewFromRow(result[0])
        })

        await emitAfterCommit(events, event)
        return saved
      })
    },
  }
}

/**
 * Non-transactional store for unit tests / expand-phase fakes.
 * Upserts via the repository, records outbox if provided, then emits.
 * Not for production — production must use createAtomicReviewCommandStore.
 */
export function createSequentialReviewCommandStore(deps: {
  upsert: (review: Omit<Review, 'createdAt' | 'updatedAt'>, now?: Date) => Promise<Review>
  events: EventBus
  recordOutbox?: (event: DomainEvent) => Promise<void>
}): ReviewCommandStore {
  return {
    upsertAndRecord: async (review, event, now) => {
      const saved = await deps.upsert(review, now)
      if (deps.recordOutbox) {
        await deps.recordOutbox(event)
      }
      await emitAfterCommit(deps.events, event)
      return saved
    },
  }
}
