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
import type { ReviewCommandStore } from '../application/ports/review-command-store.port'
import { reviewSourceTransitioned, reviewUpdated } from '../domain/events'
import { eraseReviewSourceContent } from './review-source-content-store'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import {
  persistReviewObservation,
  type PersistedReviewObservation,
} from './repositories/review-observation.repository'

type PersistObservation = (
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  input: Readonly<{
    review: Omit<Review, 'createdAt' | 'updatedAt'>
    observedAt: Date
    observationKey?: string
  }>,
) => Promise<PersistedReviewObservation>

export function createAtomicReviewCommandStore(
  db: Database,
  events: EventBus,
  persistObservation: PersistObservation = persistReviewObservation,
): ReviewCommandStore {
  return {
    upsertAndRecord: async (review, event, now, observationKey) => {
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
          const updatedAt = now ?? new Date()
          const observation = await persistObservation(tx, {
            review: { ...review, analysisSequence },
            observedAt: updatedAt,
            ...(observationKey == null ? {} : { observationKey }),
          })
          const saved = observation.review
          if (observation.duplicate || observation.outOfOrder) {
            return { saved, event: null }
          }
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

        if (committed.event) await emitAfterCommit(events, committed.event)
        return committed.saved
      })
    },
    reobserveExpiredAndRecord: async (review, _now, observationKey) => {
      return trace('review.commandStore.reobserveExpiredAndRecord', async () => {
        const committed = await db.transaction(async (tx) => {
          const existingRows = await tx
            .select()
            .from(reviews)
            .where(
              sql`${reviews.id} = ${review.id}
                AND ${reviews.organizationId} = ${review.organizationId}
                AND ${reviews.propertyId} = ${review.propertyId}
                AND ${reviews.sourceEpoch} = ${review.sourceEpoch}
                AND (
                  ${reviews.sourceContentState} IN ('source_expired', 'provider_deleted')
                  OR ${reviews.contentExpiresAt} <= transaction_timestamp()
                )`,
            )
            .for('update')
          const existingRow = existingRows[0]
          if (!existingRow) {
            throw reviewError(
              'repo_upsert_failed',
              'Review is not expired at the database boundary',
            )
          }

          const clockResult = await tx.execute(sql`
            SELECT transaction_timestamp() AS occurred_at
          `)
          const occurredAtValue = clockResult.rows[0]?.occurred_at
          const occurredAt =
            occurredAtValue instanceof Date
              ? occurredAtValue
              : typeof occurredAtValue === 'string'
                ? new Date(occurredAtValue)
                : null
          if (occurredAt === null || Number.isNaN(occurredAt.getTime())) {
            throw reviewError('repo_upsert_failed', 'Review transaction clock is invalid')
          }

          const stableIdentity = {
            id: reviewId(existingRow.id),
            organizationId: organizationId(existingRow.organizationId),
            propertyId: propertyId(existingRow.propertyId),
            sourceEpoch: existingRow.sourceEpoch,
            sourceRevision: existingRow.sourceRevision,
          }
          const recordedEvents: DomainEvent[] = []
          let previousSequence: number | null = null

          // An already-erased Review has already recorded its lifecycle fact.
          // A row whose deadline has just elapsed is redacted first, in the
          // same transaction, without removing its stable identity or history.
          if (existingRow.sourceContentState === 'active') {
            const expirySequenceResult = await tx.execute(sql`
              SELECT lock_review_ai_analysis_head_v1(
                ${review.organizationId},
                ${review.propertyId}::uuid,
                ${review.sourceEpoch}
              ) AS analysis_sequence
            `)
            const expirySequence = Number(expirySequenceResult.rows[0]?.analysis_sequence)
            if (!Number.isSafeInteger(expirySequence) || expirySequence <= 0) {
              throw reviewError(
                'repo_upsert_failed',
                'Expired Review sequence allocation failed',
              )
            }
            const expiredEvent = reviewSourceTransitioned({
              reviewId: stableIdentity.id,
              organizationId: stableIdentity.organizationId,
              propertyId: stableIdentity.propertyId,
              sourceEpoch: stableIdentity.sourceEpoch,
              sourceRevision: stableIdentity.sourceRevision,
              analysisSequence: expirySequence,
              change: 'source_expired',
              occurredAt,
            })
            const erased = await eraseReviewSourceContent(tx, {
              reviewId: stableIdentity.id,
              organizationId: stableIdentity.organizationId,
              propertyId: stableIdentity.propertyId,
              sourceEpoch: stableIdentity.sourceEpoch,
              expectedSourceRevision: stableIdentity.sourceRevision,
              state: 'source_expired',
            })
            if (!erased) {
              throw reviewError('repo_upsert_failed', 'Expired Review redaction failed')
            }
            await insertOutboxRow(tx, expiredEvent)
            recordedEvents.push(expiredEvent)
            previousSequence = expirySequence
          }

          const reobserveSequenceResult = await tx.execute(sql`
            SELECT lock_review_ai_analysis_head_v1(
              ${review.organizationId},
              ${review.propertyId}::uuid,
              ${review.sourceEpoch}
            ) AS analysis_sequence
          `)
          const reobserveSequence = Number(
            reobserveSequenceResult.rows[0]?.analysis_sequence,
          )
          if (
            !Number.isSafeInteger(reobserveSequence) ||
            reobserveSequence <= 0 ||
            (previousSequence != null && reobserveSequence !== previousSequence + 1)
          ) {
            throw reviewError(
              'repo_upsert_failed',
              'Re-observed Review sequence is not contiguous',
            )
          }

          const observation = await persistObservation(tx, {
            review: { ...review, analysisSequence: reobserveSequence },
            observedAt: occurredAt,
            ...(observationKey == null ? {} : { observationKey }),
          })
          if (observation.duplicate || observation.outOfOrder) {
            throw reviewError(
              'repo_upsert_failed',
              'Re-observed Review did not provide a current observation',
            )
          }
          const updatedEvent = reviewUpdated({
            reviewId: observation.review.id,
            organizationId: observation.review.organizationId,
            propertyId: observation.review.propertyId,
            platform: observation.review.platform,
            sourceEpoch: observation.review.sourceEpoch,
            sourceRevision: observation.review.sourceRevision,
            analysisSequence: observation.review.analysisSequence,
            occurredAt,
          })
          await insertOutboxRow(tx, updatedEvent)
          recordedEvents.push(updatedEvent)
          return {
            review: observation.review,
            events: recordedEvents,
          }
        })
        for (const event of committed.events) await emitAfterCommit(events, event)
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
  upsert: (
    review: Omit<Review, 'createdAt' | 'updatedAt'>,
    now?: Date,
    observationKey?: string,
  ) => Promise<Review>
  events: EventBus
  recordOutbox?: (event: DomainEvent) => Promise<void>
}): ReviewCommandStore {
  return {
    upsertAndRecord: async (review, event, now, observationKey) => {
      const saved = await deps.upsert(review, now, observationKey)
      const recordedEvent = typeof event === 'function' ? event(saved) : event
      if (deps.recordOutbox) {
        await deps.recordOutbox(recordedEvent)
      }
      await emitAfterCommit(deps.events, recordedEvent)
      return saved
    },
    reobserveExpiredAndRecord: async (review, now, observationKey) => {
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
        analysisSequence: review.analysisSequence + 2,
      }
      const saved = await deps.upsert(recreated, occurredAt, observationKey)
      const updatedEvent = reviewUpdated({
        reviewId: saved.id,
        organizationId: saved.organizationId,
        propertyId: saved.propertyId,
        platform: saved.platform,
        sourceEpoch: saved.sourceEpoch,
        sourceRevision: saved.sourceRevision,
        analysisSequence: saved.analysisSequence,
        occurredAt,
      })
      if (deps.recordOutbox) {
        await deps.recordOutbox(expiredEvent)
        await deps.recordOutbox(updatedEvent)
      }
      await emitAfterCommit(deps.events, expiredEvent)
      await emitAfterCommit(deps.events, updatedEvent)
      return saved
    },
  }
}
