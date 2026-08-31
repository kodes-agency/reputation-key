// Atomic review command store (BQR-2.3).
//
// One PostgreSQL transaction: reviews upsert + outbox_events insert.
// After commit: in-process EventBus emit for expand-phase legacy consumers.
// Crash after commit but before emit leaves a durable outbox row for relay.

import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { emitAfterCommit, insertOutboxRow } from '#/shared/outbox/commit'
import {
  replies,
  replyPublicationAttempts,
  replyPublicationAuthorizations,
  reviews,
} from '#/shared/db/schema/review.schema'
import { trace } from '#/shared/observability/trace'
import type { Review } from '../domain/types'
import { reviewError } from '../domain/errors'
import type { ReviewCommandStore } from '../application/ports/review-command-store.port'
import {
  reviewReplyPublicationCancelled,
  reviewSourceTransitioned,
  reviewUpdated,
} from '../domain/events'
import { eraseReviewSourceContent } from './review-source-content-store'
import { organizationId, propertyId, replyId, reviewId } from '#/shared/domain/ids'
import {
  persistReviewObservation,
  type PersistedReviewObservation,
} from './repositories/review-observation.repository'
import { lockReplyTruthScope } from './reply-truth-serialization'
import { lockReviewSourceMutationScope } from './review-source-mutation-serialization'
import type { Tx } from '#/shared/outbox/commit'
import type { ReviewProviderObservationOrigin } from '../application/ports/response-target-authority.port'

const SOURCE_ACTIVE_PUBLICATION_STATES = [
  'requested',
  'authorized',
  'sending',
  'pending_observation',
  'ambiguous',
] as const

/** Settle publication work whose immutable authorization names an older
 * Review source. The attempt remains append-only evidence but can no longer
 * be confirmed or resent. */
async function supersedeStaleReviewPublications(
  tx: Tx,
  review: Review,
  occurredAt: Date,
): Promise<DomainEvent[]> {
  const staleRows = await tx
    .select({
      id: replies.id,
      reviewId: replies.reviewId,
      organizationId: replies.organizationId,
      stateRevision: replies.stateRevision,
      publicationCycle: replies.publicationCycle,
      publicationAttempts: replies.publicationAttempts,
    })
    .from(replies)
    .leftJoin(
      replyPublicationAuthorizations,
      and(
        eq(replyPublicationAuthorizations.organizationId, replies.organizationId),
        eq(replyPublicationAuthorizations.reviewId, replies.reviewId),
        eq(replyPublicationAuthorizations.replyId, replies.id),
        eq(replyPublicationAuthorizations.publicationCycle, replies.publicationCycle),
      ),
    )
    .where(
      and(
        eq(replies.organizationId, review.organizationId),
        eq(replies.reviewId, review.id),
        eq(replies.source, 'internal'),
        inArray(replies.publicationState, [...SOURCE_ACTIVE_PUBLICATION_STATES]),
        or(
          isNull(replyPublicationAuthorizations.replyId),
          ne(replyPublicationAuthorizations.propertyId, review.propertyId),
          ne(replyPublicationAuthorizations.sourceEpoch, review.sourceEpoch),
          ne(
            replyPublicationAuthorizations.materialReviewRevision,
            review.sourceRevision,
          ),
        ),
      ),
    )
    .for('update', { of: replies })

  const facts: DomainEvent[] = []
  for (const stale of staleRows) {
    if (stale.publicationAttempts > 0) {
      await tx
        .update(replyPublicationAttempts)
        .set({
          outcome: 'superseded',
          confirmedObservationRevision: null,
          updatedAt: occurredAt,
        })
        .where(
          and(
            eq(replyPublicationAttempts.organizationId, stale.organizationId),
            eq(replyPublicationAttempts.replyId, stale.id),
            eq(replyPublicationAttempts.publicationCycle, stale.publicationCycle),
            eq(replyPublicationAttempts.attemptNumber, stale.publicationAttempts),
          ),
        )
    }
    const cancelled = await tx
      .update(replies)
      .set({
        status: 'draft',
        publicationState: 'cancelled',
        publicationLastErrorClass: null,
        reconcileDueAt: null,
        updatedAt: occurredAt,
      })
      .where(
        and(
          eq(replies.id, stale.id),
          eq(replies.organizationId, stale.organizationId),
          eq(replies.stateRevision, stale.stateRevision),
          eq(replies.publicationCycle, stale.publicationCycle),
          inArray(replies.publicationState, [...SOURCE_ACTIVE_PUBLICATION_STATES]),
        ),
      )
      .returning({ id: replies.id })
    if (!cancelled[0]) continue
    facts.push(
      reviewReplyPublicationCancelled({
        replyId: replyId(stale.id),
        reviewId: review.id,
        propertyId: review.propertyId,
        organizationId: review.organizationId,
        cause: 'source_changed',
        occurredAt,
      }),
    )
  }
  return facts
}

type ReviewSourceScope = Readonly<{
  organizationId: Review['organizationId']
  propertyId: Review['propertyId']
  sourceEpoch: number
}>

/** Allocate the next AI-analysis sequence under the per-source head lock. The
 * caller names the failure so a specific write path stays diagnosable. */
async function allocateAnalysisSequence(
  tx: Tx,
  scope: ReviewSourceScope,
  failureMessage: string,
): Promise<number> {
  const result = await tx.execute(sql`
    SELECT lock_review_ai_analysis_head_v1(
      ${scope.organizationId},
      ${scope.propertyId}::uuid,
      ${scope.sourceEpoch}
    ) AS analysis_sequence
  `)
  const sequence = Number(result.rows[0]?.analysis_sequence)
  if (!Number.isSafeInteger(sequence) || sequence <= 0) {
    throw reviewError('repo_upsert_failed', failureMessage)
  }
  return sequence
}

/** Database-side transaction clock, so every fact in this transaction shares
 * one instant that no application clock can skew. */
async function readTransactionClock(tx: Tx): Promise<Date> {
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
  return occurredAt
}

/** Take the source-epoch fence and the expired Review row together. The row is
 * returned locked, and only when the database itself agrees it is expired. */
async function lockExpiredReviewRow(
  tx: Tx,
  review: Omit<Review, 'createdAt' | 'updatedAt'>,
) {
  if (
    !(await lockReviewSourceMutationScope(tx, {
      organizationId: review.organizationId,
      propertyId: review.propertyId,
      reviewId: review.id,
      sourceEpoch: review.sourceEpoch,
    }))
  ) {
    throw reviewError(
      'repo_upsert_failed',
      'Review source epoch changed before re-observation',
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
  return existingRow
}

type StableReviewIdentity = Readonly<{
  id: ReturnType<typeof reviewId>
  organizationId: ReturnType<typeof organizationId>
  propertyId: ReturnType<typeof propertyId>
  sourceEpoch: number
  sourceRevision: number
}>

/**
 * A row whose deadline has just elapsed is redacted first, in the same
 * transaction, without removing its stable identity or history. Returns the
 * expiry fact and the sequence it consumed, so the re-observation can prove its
 * own sequence is contiguous with it.
 */
async function redactJustExpiredSourceContent(
  tx: Tx,
  identity: StableReviewIdentity,
  occurredAt: Date,
): Promise<Readonly<{ event: DomainEvent; sequence: number }>> {
  const expirySequence = await allocateAnalysisSequence(
    tx,
    identity,
    'Expired Review sequence allocation failed',
  )
  const expiredEvent = reviewSourceTransitioned({
    reviewId: identity.id,
    organizationId: identity.organizationId,
    propertyId: identity.propertyId,
    sourceEpoch: identity.sourceEpoch,
    sourceRevision: identity.sourceRevision,
    analysisSequence: expirySequence,
    change: 'source_expired',
    occurredAt,
  })
  const erased = await eraseReviewSourceContent(tx, {
    reviewId: identity.id,
    organizationId: identity.organizationId,
    propertyId: identity.propertyId,
    sourceEpoch: identity.sourceEpoch,
    expectedSourceRevision: identity.sourceRevision,
    state: 'source_expired',
  })
  if (!erased) {
    throw reviewError('repo_upsert_failed', 'Expired Review redaction failed')
  }
  await insertOutboxRow(tx, expiredEvent)
  return { event: expiredEvent, sequence: expirySequence }
}

type PersistObservation = (
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  input: Readonly<{
    review: Omit<Review, 'createdAt' | 'updatedAt'>
    observedAt: Date
    observationKey?: string
    observationOrigin?: ReviewProviderObservationOrigin
  }>,
) => Promise<PersistedReviewObservation>

export const createAtomicReviewCommandStore = (
  db: Database,
  events: EventBus,
  clock: () => Date,
  persistObservation: PersistObservation = persistReviewObservation,
): ReviewCommandStore => {
  return {
    upsertAndRecord: async (review, event, now, observationKey, observationOrigin) => {
      return trace('review.commandStore.upsertAndRecord', async () => {
        const committed = await db.transaction(async (tx) => {
          const analysisSequence = await allocateAnalysisSequence(
            tx,
            review,
            'Review analysis sequence allocation failed',
          )
          const updatedAt = now ?? clock()
          await lockReplyTruthScope(tx, review.organizationId, review.id)
          const observation = await persistObservation(tx, {
            review: { ...review, analysisSequence },
            observedAt: updatedAt,
            ...(observationKey == null ? {} : { observationKey }),
            ...(observationOrigin == null ? {} : { observationOrigin }),
          })
          const saved = observation.review
          if (observation.duplicate || observation.outOfOrder) {
            return { saved, events: [] as DomainEvent[] }
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
          const cancellationEvents = await supersedeStaleReviewPublications(
            tx,
            saved,
            updatedAt,
          )
          for (const cancellationEvent of cancellationEvents) {
            await insertOutboxRow(tx, cancellationEvent)
          }

          return { saved, events: [recordedEvent, ...cancellationEvents] }
        })

        for (const event of committed.events) await emitAfterCommit(events, event)
        return committed.saved
      })
    },
    reobserveExpiredAndRecord: async (
      review,
      _now,
      observationKey,
      observationOrigin,
    ) => {
      return trace('review.commandStore.reobserveExpiredAndRecord', async () => {
        const committed = await db.transaction(async (tx) => {
          const existingRow = await lockExpiredReviewRow(tx, review)
          const occurredAt = await readTransactionClock(tx)

          const stableIdentity: StableReviewIdentity = {
            id: reviewId(existingRow.id),
            organizationId: organizationId(existingRow.organizationId),
            propertyId: propertyId(existingRow.propertyId),
            sourceEpoch: existingRow.sourceEpoch,
            sourceRevision: existingRow.sourceRevision,
          }
          const recordedEvents: DomainEvent[] = []
          let previousSequence: number | null = null

          // An already-erased Review has already recorded its lifecycle fact.
          if (existingRow.sourceContentState === 'active') {
            const expiry = await redactJustExpiredSourceContent(
              tx,
              stableIdentity,
              occurredAt,
            )
            recordedEvents.push(expiry.event)
            previousSequence = expiry.sequence
          }

          const reobserveSequence = await allocateAnalysisSequence(
            tx,
            review,
            'Re-observed Review sequence is not contiguous',
          )
          if (previousSequence != null && reobserveSequence !== previousSequence + 1) {
            throw reviewError(
              'repo_upsert_failed',
              'Re-observed Review sequence is not contiguous',
            )
          }

          const observation = await persistObservation(tx, {
            review: { ...review, analysisSequence: reobserveSequence },
            observedAt: occurredAt,
            ...(observationKey == null ? {} : { observationKey }),
            ...(observationOrigin == null ? {} : { observationOrigin }),
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
          const cancellationEvents = await supersedeStaleReviewPublications(
            tx,
            observation.review,
            occurredAt,
          )
          for (const cancellationEvent of cancellationEvents) {
            await insertOutboxRow(tx, cancellationEvent)
          }
          recordedEvents.push(...cancellationEvents)
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
export const createSequentialReviewCommandStore = (deps: {
  upsert: (
    review: Omit<Review, 'createdAt' | 'updatedAt'>,
    now?: Date,
    observationKey?: string,
  ) => Promise<Review>
  events: EventBus
  clock: () => Date
  recordOutbox?: (event: DomainEvent) => Promise<void>
}): ReviewCommandStore => {
  return {
    upsertAndRecord: async (review, event, now, observationKey, _observationOrigin) => {
      const saved = await deps.upsert(review, now, observationKey)
      const recordedEvent = typeof event === 'function' ? event(saved) : event
      if (deps.recordOutbox) {
        await deps.recordOutbox(recordedEvent)
      }
      await emitAfterCommit(deps.events, recordedEvent)
      return saved
    },
    reobserveExpiredAndRecord: async (
      review,
      now,
      observationKey,
      _observationOrigin,
    ) => {
      const occurredAt = now ?? deps.clock()
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
