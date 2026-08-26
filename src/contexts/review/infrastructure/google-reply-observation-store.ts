import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  googleReplyObservationHeads,
  googleReplyObservations,
  replies,
  replyPublicationAuthorizations,
  replyPublicationAttempts,
  reviews,
} from '#/shared/db/schema/review.schema'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { emitAfterCommit, insertOutboxRow } from '#/shared/outbox/commit'
import { replyId, userId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type {
  GoogleReplyObservationResult,
  GoogleReplyObservationStore,
} from '../application/ports/google-reply-observation-store.port'
import {
  decideGoogleReplyObservation,
  googleReplyObservationInputDigest,
  type GoogleReplyPublicationCandidate,
} from '../domain/google-reply-observation'
import { reviewError } from '../domain/errors'
import {
  reviewReplyObserved,
  reviewReplyPublicationCancelled,
  reviewReplyPublished,
} from '../domain/events'
import { lockReplyTruthScope } from './reply-truth-serialization'

type ObservationRow = typeof googleReplyObservations.$inferSelect

function resultFromRow(
  row: ObservationRow,
  duplicate: boolean,
): GoogleReplyObservationResult {
  return {
    observationRevision: row.observationRevision,
    change: row.change as GoogleReplyObservationResult['change'],
    resolution: row.resolution as GoogleReplyObservationResult['resolution'],
    matchedReplyId: row.matchedReplyId ? replyId(row.matchedReplyId) : null,
    matchedPublicationCycle: row.matchedPublicationCycle,
    duplicate,
  }
}

/** PostgreSQL observation authority. One review-scoped advisory lock serializes
 * history revision allocation, head replacement, reply confirmation, and
 * both durable facts. */
export function createGoogleReplyObservationStore(
  db: Database,
  events: EventBus,
): GoogleReplyObservationStore {
  return {
    allocateReadGeneration: () =>
      trace('review.googleReplyObservation.allocateReadGeneration', async () => {
        const result = await db.execute(
          sql`SELECT nextval('google_reply_observation_read_generation_seq')::text AS generation`,
        )
        const generation = Number(result.rows[0]?.generation)
        if (!Number.isSafeInteger(generation) || generation < 1) {
          throw reviewError(
            'repo_upsert_failed',
            'Google reply read generation allocation failed',
          )
        }
        return generation
      }),
    findCurrentHead: (input) =>
      trace('review.googleReplyObservation.findCurrentHead', async () => {
        const rows = await db
          .select({
            observationRevision: googleReplyObservationHeads.observationRevision,
            sourceEpoch: googleReplyObservationHeads.sourceEpoch,
            materialReviewRevision: googleReplyObservationHeads.materialReviewRevision,
          })
          .from(googleReplyObservationHeads)
          .where(
            and(
              eq(googleReplyObservationHeads.organizationId, input.organizationId),
              eq(googleReplyObservationHeads.propertyId, input.propertyId),
              eq(googleReplyObservationHeads.reviewId, input.reviewId),
            ),
          )
          .limit(1)
        return rows[0] ?? null
      }),
    record: (input) =>
      trace('review.googleReplyObservation.record', async () => {
        if (
          !/^[0-9a-f]{64}$/u.test(input.observationKey) ||
          Number.isNaN(input.observedAt.getTime()) ||
          Number.isNaN(input.contentExpiresAt.getTime()) ||
          (input.providerUpdatedAt !== null &&
            Number.isNaN(input.providerUpdatedAt.getTime())) ||
          input.contentExpiresAt.getTime() <= input.observedAt.getTime() ||
          input.materialReviewRevision < 1 ||
          !Number.isSafeInteger(input.materialReviewRevision) ||
          input.readGeneration < 1 ||
          !Number.isSafeInteger(input.readGeneration) ||
          input.sourceEpoch < 0 ||
          !Number.isSafeInteger(input.sourceEpoch) ||
          (input.source === 'targeted_reconciliation' &&
            (String(input.publicationTarget.replyId).length === 0 ||
              input.publicationTarget.publicationCycle < 1 ||
              !Number.isSafeInteger(input.publicationTarget.publicationCycle) ||
              input.publicationTarget.attemptNumber < 1 ||
              !Number.isSafeInteger(input.publicationTarget.attemptNumber)))
        ) {
          throw reviewError('invalid_input', 'Invalid Google reply observation fence')
        }
        const inputDigest = googleReplyObservationInputDigest(input)

        const committed = await db.transaction(async (tx) => {
          await lockReplyTruthScope(tx, input.organizationId, input.reviewId)

          const reviewRows = await tx
            .select({
              id: reviews.id,
              propertyId: reviews.propertyId,
              sourceEpoch: reviews.sourceEpoch,
              sourceRevision: reviews.sourceRevision,
              sourceContentState: reviews.sourceContentState,
            })
            .from(reviews)
            .where(
              and(
                eq(reviews.id, input.reviewId),
                eq(reviews.organizationId, input.organizationId),
                eq(reviews.propertyId, input.propertyId),
              ),
            )
            .for('update')
            .limit(1)
          const review = reviewRows[0]
          if (!review) throw reviewError('review_not_found', 'Review not found')

          const duplicates = await tx
            .select()
            .from(googleReplyObservations)
            .where(
              and(
                eq(googleReplyObservations.organizationId, input.organizationId),
                eq(googleReplyObservations.reviewId, input.reviewId),
                eq(googleReplyObservations.observationKey, input.observationKey),
              ),
            )
            .limit(1)
          if (duplicates[0]) {
            if (
              duplicates[0].propertyId !== input.propertyId ||
              duplicates[0].inputDigest !== inputDigest
            ) {
              throw reviewError(
                'invalid_transition',
                'Observation idempotency key was reused for different provider evidence',
              )
            }
            return {
              result: resultFromRow(duplicates[0], true),
              facts: [] as DomainEvent[],
            }
          }

          // A committed idempotency key names immutable provider evidence, not
          // the Review's later current revision. Once tenant/Review ownership
          // has been proved, an exact replay must remain replay-safe even after
          // a newer source observation advances the Review. New evidence still
          // has to satisfy the current source fences below.
          if (
            review.sourceEpoch !== input.sourceEpoch ||
            review.sourceRevision !== input.materialReviewRevision
          ) {
            throw reviewError(
              'invalid_transition',
              'Google reply observation is stale for the current Review source',
            )
          }

          const headRows = await tx
            .select({
              observationRevision: googleReplyObservationHeads.observationRevision,
              sourceEpoch: googleReplyObservationHeads.sourceEpoch,
              materialReviewRevision: googleReplyObservationHeads.materialReviewRevision,
              readGeneration: googleReplyObservations.readGeneration,
              state: googleReplyObservationHeads.state,
              normalizedDigest: googleReplyObservations.normalizedDigest,
            })
            .from(googleReplyObservationHeads)
            .innerJoin(
              googleReplyObservations,
              eq(googleReplyObservations.id, googleReplyObservationHeads.observationId),
            )
            .where(eq(googleReplyObservationHeads.reviewId, input.reviewId))
            .for('update', { of: googleReplyObservationHeads })
            .limit(1)
          const head = headRows[0]
          if (head && input.readGeneration <= head.readGeneration) {
            throw reviewError(
              'invalid_transition',
              'Google reply observation was superseded by a newer provider read',
            )
          }

          const internalRows = await tx
            .select()
            .from(replies)
            .where(
              and(
                eq(replies.reviewId, input.reviewId),
                eq(replies.organizationId, input.organizationId),
                eq(replies.source, 'internal'),
              ),
            )
            .for('update')
            .limit(1)
          const internal = internalRows[0]
          const publicationTarget =
            input.source === 'targeted_reconciliation' ? input.publicationTarget : null
          if (
            publicationTarget &&
            (!internal ||
              internal.id !== publicationTarget.replyId ||
              internal.publicationCycle !== publicationTarget.publicationCycle ||
              internal.publicationAttempts !== publicationTarget.attemptNumber)
          ) {
            throw reviewError(
              'invalid_transition',
              'Targeted Google reply observation no longer matches its publication attempt',
            )
          }
          const attemptRows = internal
            ? publicationTarget
              ? await tx
                  .select()
                  .from(replyPublicationAttempts)
                  .where(
                    and(
                      eq(replyPublicationAttempts.organizationId, input.organizationId),
                      eq(replyPublicationAttempts.propertyId, input.propertyId),
                      eq(replyPublicationAttempts.reviewId, input.reviewId),
                      eq(replyPublicationAttempts.replyId, publicationTarget.replyId),
                      eq(
                        replyPublicationAttempts.publicationCycle,
                        publicationTarget.publicationCycle,
                      ),
                      eq(
                        replyPublicationAttempts.attemptNumber,
                        publicationTarget.attemptNumber,
                      ),
                    ),
                  )
                  .limit(1)
              : await tx
                  .select()
                  .from(replyPublicationAttempts)
                  .where(
                    and(
                      eq(replyPublicationAttempts.organizationId, input.organizationId),
                      eq(replyPublicationAttempts.propertyId, input.propertyId),
                      eq(replyPublicationAttempts.reviewId, input.reviewId),
                      eq(replyPublicationAttempts.replyId, internal.id),
                      eq(
                        replyPublicationAttempts.publicationCycle,
                        internal.publicationCycle,
                      ),
                    ),
                  )
                  .orderBy(desc(replyPublicationAttempts.attemptNumber))
                  .limit(1)
            : []
          const attempt = attemptRows[0]
          const zeroAttemptAuthorizationRows =
            internal?.status === 'approved' &&
            internal.publicationState === 'authorized' &&
            internal.publicationAttempts === 0
              ? await tx
                  .select({
                    publicationCycle: replyPublicationAuthorizations.publicationCycle,
                  })
                  .from(replyPublicationAuthorizations)
                  .where(
                    and(
                      eq(
                        replyPublicationAuthorizations.organizationId,
                        input.organizationId,
                      ),
                      eq(replyPublicationAuthorizations.propertyId, input.propertyId),
                      eq(replyPublicationAuthorizations.reviewId, input.reviewId),
                      eq(replyPublicationAuthorizations.replyId, internal.id),
                      eq(
                        replyPublicationAuthorizations.publicationCycle,
                        internal.publicationCycle,
                      ),
                    ),
                  )
                  .limit(1)
              : []
          const zeroAttemptAuthorization = zeroAttemptAuthorizationRows[0]
          const candidate: GoogleReplyPublicationCandidate | null =
            internal && attempt
              ? {
                  replyId: replyId(internal.id),
                  publicationCycle: attempt.publicationCycle,
                  attemptNumber: attempt.attemptNumber,
                  sourceEpoch: attempt.sourceEpoch,
                  materialReviewRevision: attempt.materialReviewRevision,
                  expectedReplyDigest: attempt.expectedReplyDigest,
                  outcome: attempt.outcome as GoogleReplyPublicationCandidate['outcome'],
                }
              : null
          const decision = decideGoogleReplyObservation({
            sourceEpoch: input.sourceEpoch,
            materialReviewRevision: input.materialReviewRevision,
            observedText: input.observedText,
            previous: head
              ? {
                  state: head.state as 'live' | 'absent',
                  normalizedDigest: head.normalizedDigest,
                  sourceEpoch: head.sourceEpoch,
                  materialReviewRevision: head.materialReviewRevision,
                }
              : null,
            candidate,
          })
          const supersedesCurrentAttempt =
            decision.resolution === 'external_current_live' &&
            candidate !== null &&
            candidate.sourceEpoch === input.sourceEpoch &&
            candidate.materialReviewRevision === input.materialReviewRevision &&
            (candidate.outcome === 'sending' ||
              candidate.outcome === 'provider_outcome_pending' ||
              candidate.outcome === 'ambiguous')
          const settlesLegacyUnattributedAttempt =
            publicationTarget !== null &&
            internal !== undefined &&
            attempt === undefined &&
            (internal.publicationState === 'sending' ||
              internal.publicationState === 'pending_observation' ||
              internal.publicationState === 'ambiguous')
          const observationRevision = (head?.observationRevision ?? 0) + 1
          if (!Number.isSafeInteger(observationRevision)) {
            throw reviewError('invalid_transition', 'Observation revision exhausted')
          }

          const inserted = await tx
            .insert(googleReplyObservations)
            .values({
              organizationId: input.organizationId,
              propertyId: input.propertyId,
              reviewId: input.reviewId,
              observationRevision,
              observationKey: input.observationKey,
              inputDigest,
              sourceEpoch: input.sourceEpoch,
              materialReviewRevision: input.materialReviewRevision,
              readGeneration: input.readGeneration,
              state: decision.state,
              change: decision.change,
              resolution: decision.resolution,
              source: input.source,
              provenance: decision.provenance,
              normalizedText: decision.normalizedText,
              normalizationVersion: 'google-reply-v1',
              normalizedDigest: decision.normalizedDigest,
              matchedReplyId: decision.matchedReplyId,
              matchedPublicationCycle: decision.matchedPublicationCycle,
              matchedAttemptNumber: decision.matchedAttemptNumber,
              providerUpdatedAt: input.providerUpdatedAt,
              observedAt: input.observedAt,
              contentExpiresAt: input.contentExpiresAt,
              createdAt: input.observedAt,
              updatedAt: input.observedAt,
            })
            .returning()
          const observation = inserted[0]
          if (!observation) {
            throw reviewError('repo_upsert_failed', 'Google reply observation failed')
          }

          await tx
            .insert(googleReplyObservationHeads)
            .values({
              reviewId: input.reviewId,
              organizationId: input.organizationId,
              propertyId: input.propertyId,
              observationId: observation.id,
              observationRevision,
              sourceEpoch: input.sourceEpoch,
              materialReviewRevision: input.materialReviewRevision,
              state: decision.state,
              provenance: decision.provenance,
              ...(head ? {} : { createdAt: input.observedAt }),
              updatedAt: input.observedAt,
            })
            .onConflictDoUpdate({
              target: googleReplyObservationHeads.reviewId,
              set: {
                observationId: observation.id,
                observationRevision,
                sourceEpoch: input.sourceEpoch,
                materialReviewRevision: input.materialReviewRevision,
                state: decision.state,
                provenance: decision.provenance,
                updatedAt: input.observedAt,
              },
            })

          // Contract-phase cleanup happens later, but provider-controlled
          // reply text now has one lifecycle owner. Remove any legacy mirror
          // after the governed observation is durable so it cannot become a
          // stale second source of provider truth.
          await tx
            .delete(replies)
            .where(
              and(
                eq(replies.organizationId, input.organizationId),
                eq(replies.reviewId, input.reviewId),
                eq(replies.source, 'google_sync'),
              ),
            )

          // A different current-live provider reply closes the handling target
          // with external/unknown provenance. Fence the in-flight RepKey
          // publication at the same observation boundary so it can neither be
          // retried nor retroactively confirmed if Google later changes again.
          let providerTruthCancellationFact: DomainEvent | null = null
          if (supersedesCurrentAttempt && internal && attempt) {
            const cancelled = await tx
              .update(replies)
              .set({
                status: 'draft',
                publicationState: 'cancelled',
                publicationLastErrorClass: null,
                reconcileDueAt: null,
                updatedAt: input.observedAt,
              })
              .where(
                and(
                  eq(replies.id, internal.id),
                  eq(replies.organizationId, input.organizationId),
                  eq(replies.publicationCycle, attempt.publicationCycle),
                  eq(replies.publicationAttempts, attempt.attemptNumber),
                  inArray(replies.status, ['approved', 'publish_failed']),
                  inArray(replies.publicationState, [
                    'sending',
                    'pending_observation',
                    'ambiguous',
                  ]),
                ),
              )
              .returning({ id: replies.id })
            if (!cancelled[0]) {
              throw reviewError(
                'invalid_transition',
                'Reply changed while recording an external current Google reply',
              )
            }
            const superseded = await tx
              .update(replyPublicationAttempts)
              .set({
                outcome: 'superseded',
                confirmedObservationRevision: null,
                updatedAt: input.observedAt,
              })
              .where(
                and(
                  eq(replyPublicationAttempts.id, attempt.id),
                  inArray(replyPublicationAttempts.outcome, [
                    'sending',
                    'provider_outcome_pending',
                    'ambiguous',
                  ]),
                ),
              )
              .returning({ id: replyPublicationAttempts.id })
            if (!superseded[0]) {
              throw reviewError(
                'invalid_transition',
                'Publication attempt changed while recording external provider truth',
              )
            }
            providerTruthCancellationFact = reviewReplyPublicationCancelled({
              replyId: replyId(internal.id),
              reviewId: input.reviewId,
              propertyId: input.propertyId,
              organizationId: input.organizationId,
              cause: 'provider_truth',
              occurredAt: input.observedAt,
            })
          }

          // A manager authorizes the exact provider head they observed. Any
          // fresh head—live or absent—supersedes a zero-attempt authorization
          // before the first provider call. Cancel it at this same serialized
          // observation boundary so a delayed durable intent cannot leave an
          // invisible authorized row or publish against different truth.
          if (zeroAttemptAuthorization && internal) {
            const cancelled = await tx
              .update(replies)
              .set({
                status: 'draft',
                publicationState: 'cancelled',
                publicationLastErrorClass: null,
                reconcileDueAt: null,
                updatedAt: input.observedAt,
              })
              .where(
                and(
                  eq(replies.id, internal.id),
                  eq(replies.organizationId, input.organizationId),
                  eq(replies.publicationCycle, zeroAttemptAuthorization.publicationCycle),
                  eq(replies.publicationAttempts, 0),
                  eq(replies.stateRevision, internal.stateRevision),
                  eq(replies.status, 'approved'),
                  eq(replies.publicationState, 'authorized'),
                ),
              )
              .returning({ id: replies.id })
            if (!cancelled[0]) {
              throw reviewError(
                'invalid_transition',
                'Reply changed while superseding its zero-attempt authorization',
              )
            }
            providerTruthCancellationFact = reviewReplyPublicationCancelled({
              replyId: replyId(internal.id),
              reviewId: input.reviewId,
              propertyId: input.propertyId,
              organizationId: input.organizationId,
              cause: 'provider_truth',
              occurredAt: input.observedAt,
            })
          }

          // Expand migration deliberately creates no synthetic attempt or
          // authorization provenance for pre-RPL uncertain sends. One exact
          // targeted GET can still settle that quarantined local workflow:
          // live truth is external/unknown, absence proves a fresh manager
          // authorization is required. In both cases, never send the legacy
          // Reply automatically.
          if (settlesLegacyUnattributedAttempt && internal && publicationTarget) {
            const settled = await tx
              .update(replies)
              .set({
                status: 'draft',
                publicationState: 'cancelled',
                publicationLastErrorClass: null,
                reconcileDueAt: null,
                updatedAt: input.observedAt,
              })
              .where(
                and(
                  eq(replies.id, internal.id),
                  eq(replies.organizationId, input.organizationId),
                  eq(replies.publicationCycle, publicationTarget.publicationCycle),
                  eq(replies.publicationAttempts, publicationTarget.attemptNumber),
                  inArray(replies.status, ['approved', 'publish_failed']),
                  inArray(replies.publicationState, [
                    'sending',
                    'pending_observation',
                    'ambiguous',
                  ]),
                ),
              )
              .returning({ id: replies.id })
            if (!settled[0]) {
              throw reviewError(
                'invalid_transition',
                'Legacy publication changed while recording provider truth',
              )
            }
            providerTruthCancellationFact = reviewReplyPublicationCancelled({
              replyId: replyId(internal.id),
              reviewId: input.reviewId,
              propertyId: input.propertyId,
              organizationId: input.organizationId,
              cause: 'provider_truth',
              occurredAt: input.observedAt,
            })
          }

          const facts: DomainEvent[] = []
          if (providerTruthCancellationFact) {
            facts.push(providerTruthCancellationFact)
          }
          if (decision.resolution === 'confirmed_on_google' && internal && attempt) {
            const confirmed = await tx
              .update(replies)
              .set({
                status: 'published',
                publicationState: 'published',
                publishedAt: input.observedAt,
                reconcileDueAt: null,
                updatedAt: input.observedAt,
              })
              .where(
                and(
                  eq(replies.id, internal.id),
                  eq(replies.organizationId, input.organizationId),
                  eq(replies.publicationCycle, attempt.publicationCycle),
                  inArray(replies.status, ['approved', 'publish_failed']),
                  inArray(replies.publicationState, [
                    'sending',
                    'pending_observation',
                    'ambiguous',
                    'terminal',
                  ]),
                ),
              )
              .returning({ id: replies.id })
            if (!confirmed[0]) {
              throw reviewError(
                'invalid_transition',
                'Reply changed while confirming the Google observation',
              )
            }
            await tx
              .update(replyPublicationAttempts)
              .set({
                outcome: 'confirmed',
                confirmedObservationRevision: observationRevision,
                updatedAt: input.observedAt,
              })
              .where(eq(replyPublicationAttempts.id, attempt.id))
            facts.push(
              reviewReplyPublished({
                replyId: replyId(internal.id),
                reviewId: input.reviewId,
                propertyId: input.propertyId,
                organizationId: input.organizationId,
                userId: null,
                authorId: internal.createdBy ? userId(internal.createdBy) : null,
                occurredAt: input.observedAt,
              }),
            )
          }

          if (decision.resolution !== 'unchanged') {
            facts.push(
              reviewReplyObserved({
                reviewId: input.reviewId,
                propertyId: input.propertyId,
                organizationId: input.organizationId,
                observationRevision,
                sourceEpoch: input.sourceEpoch,
                materialReviewRevision: input.materialReviewRevision,
                change: decision.change,
                resolution: decision.resolution,
                provenance: decision.provenance,
                matchedReplyId: decision.matchedReplyId,
                matchedPublicationCycle: decision.matchedPublicationCycle,
                occurredAt: input.observedAt,
              }),
            )
          }
          for (const fact of facts) await insertOutboxRow(tx, fact)
          return { result: resultFromRow(observation, false), facts }
        })

        for (const fact of committed.facts) await emitAfterCommit(events, fact)
        return committed.result
      }),
  }
}
