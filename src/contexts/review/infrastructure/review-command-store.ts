// Atomic review command store (BQR-2.3).
//
// One PostgreSQL transaction: reviews upsert + outbox_events insert.
// After commit: in-process EventBus emit for expand-phase legacy consumers.
// Crash after commit but before emit leaves a durable outbox row for relay.

import { sql } from 'drizzle-orm'
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
import { reviewCreated, reviewSourceTransitioned } from '../domain/events'

export function createAtomicReviewCommandStore(
  db: Database,
  events: EventBus,
): ReviewCommandStore {
  return {
    upsertAndRecord: async (review, event, now) => {
      return trace('review.commandStore.upsertAndRecord', async () => {
        const committed = await db.transaction(async (tx) => {
          const sequenceResult = await tx.execute(sql`
            SELECT lock_review_ai_analysis_head_v1(
              ${review.organizationId},
              ${review.propertyId}::uuid,
              ${review.sourceEpoch}
            ) AS analysis_sequence
          `)
          const sequenceValue = sequenceResult.rows[0]?.analysis_sequence
          const analysisSequence = Number(sequenceValue)
          if (!Number.isSafeInteger(analysisSequence) || analysisSequence <= 0) {
            throw reviewError(
              'repo_upsert_failed',
              'Review analysis sequence allocation failed',
            )
          }
          const sequencedReview = { ...review, analysisSequence }
          const row = reviewToRow(sequencedReview)
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
                // sync-reviews computes translatedText on every observation;
                // omitting it here froze the provider translation at whatever
                // the very first fetch saw (or NULL) forever.
                translatedText: row.translatedText,
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
                sourceEpoch: row.sourceEpoch,
                sourceRevision: row.sourceRevision,
                analysisSequence: row.analysisSequence,
                aiSourceByteLength: row.aiSourceByteLength,
                aiSourceDigest: row.aiSourceDigest,
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

          const saved = reviewFromRow(result[0])
          const candidateEvent = typeof event === 'function' ? event(saved) : event
          const recordedEvent =
            candidateEvent._tag === 'review.created' ||
            candidateEvent._tag === 'review.updated'
              ? {
                  ...candidateEvent,
                  analysisSequence: saved.analysisSequence,
                  sourceRevision: saved.sourceRevision,
                }
              : candidateEvent
          await insertOutboxRow(tx, recordedEvent)

          return { saved, event: recordedEvent }
        })

        await emitAfterCommit(events, committed.event)
        return committed.saved
      })
    },
    reobserveExpiredAndRecord: async (review, _now) => {
      return trace('review.commandStore.reobserveExpiredAndRecord', async () => {
        const committed = await db.transaction(async (tx) => {
          const firstSequenceResult = await tx.execute(sql`
            SELECT lock_review_ai_analysis_head_v1(
              ${review.organizationId},
              ${review.propertyId}::uuid,
              ${review.sourceEpoch}
            ) AS analysis_sequence,
            transaction_timestamp() AS occurred_at
          `)
          const firstValue = firstSequenceResult.rows[0]
          const firstSequence = Number(firstValue?.analysis_sequence)
          const occurredAt = firstValue?.occurred_at
          if (
            !Number.isSafeInteger(firstSequence) ||
            firstSequence <= 0 ||
            !(occurredAt instanceof Date)
          ) {
            throw reviewError(
              'repo_upsert_failed',
              'Expired Review sequence allocation failed',
            )
          }
          const existingRows = await tx
            .select()
            .from(reviews)
            .where(
              sql`${reviews.id} = ${review.id}
                AND ${reviews.organizationId} = ${review.organizationId}
                AND ${reviews.propertyId} = ${review.propertyId}
                AND ${reviews.sourceEpoch} = ${review.sourceEpoch}
                AND ${reviews.contentExpiresAt} <= transaction_timestamp()`,
            )
            .for('update')
          const existingRow = existingRows[0]
          if (!existingRow) {
            throw reviewError(
              'repo_upsert_failed',
              'Review is not expired at the database boundary',
            )
          }
          const existing = reviewFromRow(existingRow)
          const expiredEvent = reviewSourceTransitioned({
            reviewId: existing.id,
            organizationId: existing.organizationId,
            propertyId: existing.propertyId,
            sourceEpoch: existing.sourceEpoch,
            sourceRevision: existing.sourceRevision,
            analysisSequence: firstSequence,
            change: 'source_expired',
            occurredAt,
          })
          await tx.delete(reviews).where(sql`${reviews.id} = ${existing.id}`)

          const secondSequenceResult = await tx.execute(sql`
            SELECT lock_review_ai_analysis_head_v1(
              ${review.organizationId},
              ${review.propertyId}::uuid,
              ${review.sourceEpoch}
            ) AS analysis_sequence
          `)
          const secondSequence = Number(secondSequenceResult.rows[0]?.analysis_sequence)
          if (
            !Number.isSafeInteger(secondSequence) ||
            secondSequence !== firstSequence + 1
          ) {
            throw reviewError(
              'repo_upsert_failed',
              'Re-observed Review sequence is not contiguous',
            )
          }
          const recreated = {
            ...review,
            sourceRevision: existing.sourceRevision + 1,
            analysisSequence: secondSequence,
          }
          const inserted = await tx
            .insert(reviews)
            .values(reviewToRow(recreated))
            .returning()
          if (!inserted[0]) {
            throw reviewError(
              'repo_upsert_failed',
              'Re-observed Review insert returned no row',
            )
          }
          const createdEvent = reviewCreated({
            reviewId: recreated.id,
            organizationId: recreated.organizationId,
            propertyId: recreated.propertyId,
            platform: recreated.platform,
            sourceEpoch: recreated.sourceEpoch,
            sourceRevision: recreated.sourceRevision,
            analysisSequence: secondSequence,
            occurredAt,
          })
          await insertOutboxRow(tx, expiredEvent)
          await insertOutboxRow(tx, createdEvent)
          return {
            review: reviewFromRow(inserted[0]),
            expiredEvent,
            createdEvent,
          }
        })
        await emitAfterCommit(events, committed.expiredEvent)
        await emitAfterCommit(events, committed.createdEvent)
        return committed.review
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
      const recordedEvent = typeof event === 'function' ? event(saved) : event
      if (deps.recordOutbox) {
        await deps.recordOutbox(recordedEvent)
      }
      await emitAfterCommit(deps.events, recordedEvent)
      return saved
    },
    reobserveExpiredAndRecord: async (review, now) => {
      const occurredAt = now ?? new Date()
      const expiredEvent = reviewSourceTransitioned({
        reviewId: review.id,
        organizationId: review.organizationId,
        propertyId: review.propertyId,
        sourceEpoch: review.sourceEpoch,
        sourceRevision: review.sourceRevision,
        analysisSequence: review.analysisSequence + 1,
        change: 'source_expired',
        occurredAt,
      })
      const recreated = {
        ...review,
        sourceRevision: review.sourceRevision + 1,
        analysisSequence: review.analysisSequence + 2,
      }
      const createdEvent = reviewCreated({
        reviewId: recreated.id,
        organizationId: recreated.organizationId,
        propertyId: recreated.propertyId,
        platform: recreated.platform,
        sourceEpoch: recreated.sourceEpoch,
        sourceRevision: recreated.sourceRevision,
        analysisSequence: recreated.analysisSequence,
        occurredAt,
      })
      const saved = await deps.upsert(recreated, occurredAt)
      if (deps.recordOutbox) {
        await deps.recordOutbox(expiredEvent)
        await deps.recordOutbox(createdEvent)
      }
      await emitAfterCommit(deps.events, expiredEvent)
      await emitAfterCommit(deps.events, createdEvent)
      return saved
    },
  }
}
