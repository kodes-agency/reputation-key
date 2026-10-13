// Atomic review command store (BQR-2.3).
//
// One PostgreSQL transaction commits each Review mutation with its outbox
// rows, so the durable fact and state change are atomic.

import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { DomainEvent } from '#/shared/events/events'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { purgeAiDraftsForReview } from '#/shared/db/ai/ai-draft-purge'
import {
  replies,
  replyPublicationAttempts,
  replyPublicationAuthorizations,
  reviews,
} from '#/shared/db/schema/review.schema'
import { trace } from '#/shared/observability/trace'
import type { Review } from '../domain/types'
import { reviewError } from '../domain/errors'
import { isGuestEdit } from '../domain/material-review-revision'
import { rowReplyAuthor } from '../domain/reply-author'
import { takenBackByGuestEdit } from '../domain/reply-command-preconditions'
import type { ReviewCommandStore } from '../application/ports/review-command-store.port'
import {
  reviewReplyPublicationCancelled,
  reviewSourceTransitioned,
  reviewUpdated,
} from '../domain/events'
import { replyFromRow } from './mappers/reply.mapper'
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

type CurrentAttemptRef = Readonly<{
  id: string
  organizationId: string
  publicationCycle: number
  publicationAttempts: number
}>

/** Close the Reply's newest attempt as superseded. It stays as append-only
 * evidence of what was tried and can no longer be confirmed. A cycle no worker
 * claimed has no attempt to close. */
async function supersedeCurrentAttempt(
  tx: Tx,
  reply: CurrentAttemptRef,
  occurredAt: Date,
): Promise<void> {
  if (reply.publicationAttempts < 1) return
  await tx
    .update(replyPublicationAttempts)
    .set({
      outcome: 'superseded',
      confirmedObservationRevision: null,
      updatedAt: occurredAt,
    })
    .where(
      and(
        eq(replyPublicationAttempts.organizationId, reply.organizationId),
        eq(replyPublicationAttempts.replyId, reply.id),
        eq(replyPublicationAttempts.publicationCycle, reply.publicationCycle),
        eq(replyPublicationAttempts.attemptNumber, reply.publicationAttempts),
      ),
    )
}

/** Settle publication work whose immutable authorization names an older
 * Review source. The attempt remains append-only evidence but can no longer
 * be confirmed or resent.
 *
 * A Reply this returns to draft may be AI-assisted: the worker had claimed it
 * (`sending`, `pending_observation`, `ambiguous`), so the AI draft purge that
 * ran with the observation left it alone. Its text answered the revision the
 * guest replaced and its binding is stale for good, so as it stands it could
 * never be submitted again. The purge therefore runs once more, now that the
 * row is one it empties (`src/shared/db/ai/ai-draft-purge.ts`). It records no
 * second fact: the `source_changed` one below already told the people waiting. */
async function supersedeStaleReviewPublications(
  tx: Tx,
  review: Review,
  occurredAt: Date,
): Promise<void> {
  const staleRows = await tx
    .select({
      id: replies.id,
      reviewId: replies.reviewId,
      organizationId: replies.organizationId,
      stateRevision: replies.stateRevision,
      publicationCycle: replies.publicationCycle,
      publicationAttempts: replies.publicationAttempts,
      createdBy: replies.createdBy,
      submittedBy: replies.submittedBy,
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

  let returnedToDraft = 0
  for (const stale of staleRows) {
    await supersedeCurrentAttempt(tx, stale, occurredAt)
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
    returnedToDraft += 1
    await insertOutboxRow(
      tx,
      reviewReplyPublicationCancelled({
        replyId: replyId(stale.id),
        reviewId: review.id,
        propertyId: review.propertyId,
        organizationId: review.organizationId,
        authorId: rowReplyAuthor(stale),
        cause: 'source_changed',
        occurredAt,
      }),
    )
  }
  if (returnedToDraft > 0) {
    await purgeAiDraftsForReview(tx, {
      organizationId: review.organizationId,
      reviewId: review.id,
    })
  }
}

/**
 * A guest edit also takes back the Reply a manager wrote and put forward for
 * the review as it stood: one awaiting approval, or one whose publication
 * failed and that Try publishing again would send under the approval it got
 * for the earlier review (`takenBackByGuestEdit`). It returns to draft with
 * its text. One `review.reply.publication_cancelled` fact (cause
 * `source_changed`) tells its author and the people who can approve, and
 * retires the approval request or the failure notice that was waiting on it.
 * The authorization and attempts of a failed cycle say how it ended and are
 * left as they are, with one exception: an attempt whose outcome was never
 * learned is closed as superseded, as the stale-publication write closes one
 * that is still being checked. No read of the edited review can confirm it.
 *
 * Runs after the stale-publication write above, so an open cycle is already
 * cancelled. A Review holds one internal Reply; the state revision in the
 * write is the row this transaction locked.
 */
async function takeBackReplyPutForwardBeforeGuestEdit(
  tx: Tx,
  review: Review,
  occurredAt: Date,
): Promise<void> {
  const rows = await tx
    .select()
    .from(replies)
    .where(
      and(
        eq(replies.organizationId, review.organizationId),
        eq(replies.reviewId, review.id),
        eq(replies.source, 'internal'),
      ),
    )
    .for('update')
  for (const row of rows) {
    const takenBack = takenBackByGuestEdit(replyFromRow(row))
    if (!takenBack) continue
    const returned = await tx
      .update(replies)
      .set({
        status: takenBack.status,
        publicationState: takenBack.publicationState,
        publicationLastErrorClass: null,
        reconcileDueAt: null,
        updatedAt: occurredAt,
      })
      .where(
        and(
          eq(replies.id, row.id),
          eq(replies.organizationId, row.organizationId),
          eq(replies.stateRevision, row.stateRevision),
        ),
      )
      .returning({ id: replies.id })
    if (!returned[0]) continue
    if (takenBack.supersedesAttempt) await supersedeCurrentAttempt(tx, row, occurredAt)
    await insertOutboxRow(
      tx,
      reviewReplyPublicationCancelled({
        replyId: replyId(row.id),
        reviewId: review.id,
        propertyId: review.propertyId,
        organizationId: review.organizationId,
        authorId: rowReplyAuthor(row),
        cause: 'source_changed',
        occurredAt,
      }),
    )
  }
}

/**
 * What an applied observation means for the Replies written before it. Any
 * observation settles publication work authorized for an older source. A guest
 * edit also takes back what a manager had put forward; a source-epoch carry
 * of unchanged material does not, because the review it answers is the same.
 */
async function fenceRepliesWrittenForAnOlderSource(
  tx: Tx,
  observation: Pick<PersistedReviewObservation, 'review' | 'comparison'>,
  occurredAt: Date,
): Promise<void> {
  await supersedeStaleReviewPublications(tx, observation.review, occurredAt)
  if (isGuestEdit(observation.comparison)) {
    await takeBackReplyPutForwardBeforeGuestEdit(tx, observation.review, occurredAt)
  }
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

/** Take the current Property epoch fence and an expired Review row together.
 * The row may be from an older epoch that this observation will carry forward. */
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
        AND ${reviews.sourceEpoch} <= ${review.sourceEpoch}
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
 * transaction, without removing its stable identity or history. The returned
 * sequence lets the re-observation prove its own sequence is contiguous.
 */
async function redactJustExpiredSourceContent(
  tx: Tx,
  identity: StableReviewIdentity,
  occurredAt: Date,
): Promise<number> {
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
  return expirySequence
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
  clock: () => Date,
  persistObservation: PersistObservation = persistReviewObservation,
): ReviewCommandStore => {
  return {
    upsertAndRecord: async (review, event, now, observationKey, observationOrigin) => {
      return trace('review.commandStore.upsertAndRecord', async () => {
        return db.transaction(async (tx) => {
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
            return saved
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
          await fenceRepliesWrittenForAnOlderSource(tx, observation, updatedAt)

          return saved
        })
      })
    },
    reobserveExpiredAndRecord: async (
      review,
      _now,
      observationKey,
      observationOrigin,
    ) => {
      return trace('review.commandStore.reobserveExpiredAndRecord', async () => {
        return db.transaction(async (tx) => {
          const existingRow = await lockExpiredReviewRow(tx, review)
          const occurredAt = await readTransactionClock(tx)

          const stableIdentity: StableReviewIdentity = {
            id: reviewId(existingRow.id),
            organizationId: organizationId(existingRow.organizationId),
            propertyId: propertyId(existingRow.propertyId),
            sourceEpoch: existingRow.sourceEpoch,
            sourceRevision: existingRow.sourceRevision,
          }
          let previousSequence: number | null = null

          // An already-erased Review has recorded its lifecycle fact. A row from
          // a superseded epoch cannot allocate another old-epoch sequence after
          // the Property fence moves; this observation replaces it atomically.
          if (
            existingRow.sourceEpoch === review.sourceEpoch &&
            existingRow.sourceContentState === 'active'
          ) {
            previousSequence = await redactJustExpiredSourceContent(
              tx,
              stableIdentity,
              occurredAt,
            )
          }

          const reobserveSequence = await allocateAnalysisSequence(
            tx,
            review,
            'Re-observed Review sequence is not contiguous',
          )
          if (
            previousSequence != null &&
            existingRow.sourceEpoch === review.sourceEpoch &&
            reobserveSequence !== previousSequence + 1
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
            ...(observationOrigin == null ? {} : { observationOrigin }),
            analysisSequence: observation.review.analysisSequence,
            occurredAt,
          })
          await insertOutboxRow(tx, updatedEvent)
          await fenceRepliesWrittenForAnOlderSource(tx, observation, occurredAt)
          return observation.review
        })
      })
    },
  }
}

/**
 * Non-transactional store for unit tests. Upserts via the repository and
 * records outbox facts through the optional test seam.
 * Not for production — production must use createAtomicReviewCommandStore.
 */
export const createSequentialReviewCommandStore = (deps: {
  upsert: (
    review: Omit<Review, 'createdAt' | 'updatedAt'>,
    now?: Date,
    observationKey?: string,
  ) => Promise<Review>
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
      return saved
    },
  }
}
