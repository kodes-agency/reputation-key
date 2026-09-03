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
import { emitAfterCommit, insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import { replyId, userId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type {
  GoogleReplyObservationResult,
  GoogleReplyObservationStore,
  GoogleReplyPublicationTarget,
  RecordGoogleReplyObservation,
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
type InternalReplyRow = typeof replies.$inferSelect
type PublicationAttemptRow = typeof replyPublicationAttempts.$inferSelect

/** Publication states in which a RepKey write may already have reached Google
 * without its local outcome being settled. */
const UNCERTAIN_PUBLICATION_STATES = [
  'sending',
  'pending_observation',
  'ambiguous',
] as const

const CLAIMABLE_PUBLICATION_STATUSES = ['approved', 'publish_failed'] as const

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

/** Payload fence for one observation command: a well-formed idempotency key,
 * usable clocks, an expiry after the observation, in-range source counters, and
 * — for a targeted read — a complete publication target. */
function assertObservationFence(input: RecordGoogleReplyObservation): void {
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
}

/** The Review this observation names, locked for the rest of the transaction. */
async function lockObservationSubject(tx: Tx, input: RecordGoogleReplyObservation) {
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
  return review
}

/**
 * A committed idempotency key names immutable provider evidence, not the
 * Review's later current revision. Once tenant/Review ownership has been
 * proved, an exact replay must remain replay-safe even after a newer source
 * observation advances the Review; reusing the key for different evidence is a
 * bug and is refused.
 */
async function findReplayedObservation(
  tx: Tx,
  input: RecordGoogleReplyObservation,
  inputDigest: string,
): Promise<ObservationRow | null> {
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
  const replayed = duplicates[0]
  if (!replayed) return null
  if (replayed.propertyId !== input.propertyId || replayed.inputDigest !== inputDigest) {
    throw reviewError(
      'invalid_transition',
      'Observation idempotency key was reused for different provider evidence',
    )
  }
  return replayed
}

/** The observation the current head points at, in full. */
async function selectHeadObservation(
  tx: Tx,
  input: RecordGoogleReplyObservation,
): Promise<ObservationRow | undefined> {
  const rows = await tx
    .select({ observation: googleReplyObservations })
    .from(googleReplyObservationHeads)
    .innerJoin(
      googleReplyObservations,
      eq(googleReplyObservations.id, googleReplyObservationHeads.observationId),
    )
    .where(
      and(
        eq(googleReplyObservationHeads.organizationId, input.organizationId),
        eq(googleReplyObservationHeads.reviewId, input.reviewId),
      ),
    )
    .limit(1)
  return rows[0]?.observation
}

function selectCurrentHead(tx: Tx, input: RecordGoogleReplyObservation) {
  return tx
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
    .where(
      and(
        eq(googleReplyObservationHeads.organizationId, input.organizationId),
        eq(googleReplyObservationHeads.reviewId, input.reviewId),
      ),
    )
    .for('update', { of: googleReplyObservationHeads })
    .limit(1)
}

type ObservationHeadRow = Awaited<ReturnType<typeof selectCurrentHead>>[number]

/** The attempt this observation may attribute: the exact attempt a targeted
 * read names, otherwise the newest attempt of the Reply's current cycle. */
async function readAttributableAttempt(
  tx: Tx,
  input: RecordGoogleReplyObservation,
  internal: InternalReplyRow | undefined,
  publicationTarget: GoogleReplyPublicationTarget | null,
): Promise<PublicationAttemptRow | undefined> {
  if (!internal) return undefined
  if (publicationTarget) {
    const rows = await tx
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
          eq(replyPublicationAttempts.attemptNumber, publicationTarget.attemptNumber),
        ),
      )
      .limit(1)
    return rows[0]
  }
  const rows = await tx
    .select()
    .from(replyPublicationAttempts)
    .where(
      and(
        eq(replyPublicationAttempts.organizationId, input.organizationId),
        eq(replyPublicationAttempts.propertyId, input.propertyId),
        eq(replyPublicationAttempts.reviewId, input.reviewId),
        eq(replyPublicationAttempts.replyId, internal.id),
        eq(replyPublicationAttempts.publicationCycle, internal.publicationCycle),
      ),
    )
    .orderBy(desc(replyPublicationAttempts.attemptNumber))
    .limit(1)
  return rows[0]
}

/** A manager authorization that has not yet produced a provider call. */
async function readZeroAttemptAuthorization(
  tx: Tx,
  input: RecordGoogleReplyObservation,
  internal: InternalReplyRow | undefined,
): Promise<Readonly<{ publicationCycle: number }> | undefined> {
  if (
    internal === undefined ||
    internal.status !== 'approved' ||
    internal.publicationState !== 'authorized' ||
    internal.publicationAttempts !== 0
  ) {
    return undefined
  }
  const rows = await tx
    .select({ publicationCycle: replyPublicationAuthorizations.publicationCycle })
    .from(replyPublicationAuthorizations)
    .where(
      and(
        eq(replyPublicationAuthorizations.organizationId, input.organizationId),
        eq(replyPublicationAuthorizations.propertyId, input.propertyId),
        eq(replyPublicationAuthorizations.reviewId, input.reviewId),
        eq(replyPublicationAuthorizations.replyId, internal.id),
        eq(replyPublicationAuthorizations.publicationCycle, internal.publicationCycle),
      ),
    )
    .limit(1)
  return rows[0]
}

type PublicationEvidence = Readonly<{
  internal: InternalReplyRow | undefined
  attempt: PublicationAttemptRow | undefined
  zeroAttemptAuthorization: Readonly<{ publicationCycle: number }> | undefined
  publicationTarget: GoogleReplyPublicationTarget | null
}>

/** Every local publication fact this observation may act on, read under the
 * same Review-scoped lock. A targeted read that no longer matches its own
 * publication attempt is refused rather than attributed to the wrong cycle. */
async function loadPublicationEvidence(
  tx: Tx,
  input: RecordGoogleReplyObservation,
): Promise<PublicationEvidence> {
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
  return {
    internal,
    attempt: await readAttributableAttempt(tx, input, internal, publicationTarget),
    zeroAttemptAuthorization: await readZeroAttemptAuthorization(tx, input, internal),
    publicationTarget,
  }
}

/** A different current-live provider reply closes the handling target with
 * external/unknown provenance, so the in-flight RepKey attempt for the same
 * source must be fenced at this same observation boundary. */
function supersedesCurrentAttempt(
  resolution: string,
  candidate: GoogleReplyPublicationCandidate | null,
  input: RecordGoogleReplyObservation,
): boolean {
  return (
    resolution === 'external_current_live' &&
    candidate !== null &&
    candidate.sourceEpoch === input.sourceEpoch &&
    candidate.materialReviewRevision === input.materialReviewRevision &&
    (candidate.outcome === 'sending' ||
      candidate.outcome === 'provider_outcome_pending' ||
      candidate.outcome === 'ambiguous')
  )
}

/** Expand migration deliberately creates no synthetic attempt or authorization
 * provenance for pre-RPL uncertain sends, so a targeted read can find an
 * in-flight Reply with no attempt row behind it. */
function settlesLegacyUnattributedAttempt(
  evidence: PublicationEvidence,
): evidence is PublicationEvidence &
  Readonly<{
    internal: InternalReplyRow
    publicationTarget: GoogleReplyPublicationTarget
  }> {
  const { internal, attempt, publicationTarget } = evidence
  return (
    publicationTarget !== null &&
    internal !== undefined &&
    attempt === undefined &&
    (internal.publicationState === 'sending' ||
      internal.publicationState === 'pending_observation' ||
      internal.publicationState === 'ambiguous')
  )
}

const cancelledReplySet = (observedAt: Date) => ({
  status: 'draft' as const,
  publicationState: 'cancelled' as const,
  publicationLastErrorClass: null,
  reconcileDueAt: null,
  updatedAt: observedAt,
})

function providerTruthCancellationFact(
  input: RecordGoogleReplyObservation,
  internalId: string,
): DomainEvent {
  return reviewReplyPublicationCancelled({
    replyId: replyId(internalId),
    reviewId: input.reviewId,
    propertyId: input.propertyId,
    organizationId: input.organizationId,
    cause: 'provider_truth',
    occurredAt: input.observedAt,
  })
}

/**
 * Fence the in-flight RepKey publication at this observation boundary so it can
 * neither be retried nor retroactively confirmed if Google later changes again,
 * and mark its attempt superseded.
 */
async function supersedeExternalCurrentAttempt(
  tx: Tx,
  input: RecordGoogleReplyObservation,
  internal: InternalReplyRow,
  attempt: PublicationAttemptRow,
): Promise<DomainEvent> {
  const cancelled = await tx
    .update(replies)
    .set(cancelledReplySet(input.observedAt))
    .where(
      and(
        eq(replies.id, internal.id),
        eq(replies.organizationId, input.organizationId),
        eq(replies.publicationCycle, attempt.publicationCycle),
        eq(replies.publicationAttempts, attempt.attemptNumber),
        inArray(replies.status, [...CLAIMABLE_PUBLICATION_STATUSES]),
        inArray(replies.publicationState, [...UNCERTAIN_PUBLICATION_STATES]),
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
  return providerTruthCancellationFact(input, internal.id)
}

/**
 * A manager authorizes the exact provider head they observed. Any fresh
 * head — live or absent — supersedes a zero-attempt authorization before the
 * first provider call. Cancel it at this same serialized observation boundary
 * so a delayed durable intent cannot leave an invisible authorized row or
 * publish against different truth.
 */
async function cancelZeroAttemptAuthorization(
  tx: Tx,
  input: RecordGoogleReplyObservation,
  internal: InternalReplyRow,
  authorization: Readonly<{ publicationCycle: number }>,
): Promise<DomainEvent> {
  const cancelled = await tx
    .update(replies)
    .set(cancelledReplySet(input.observedAt))
    .where(
      and(
        eq(replies.id, internal.id),
        eq(replies.organizationId, input.organizationId),
        eq(replies.publicationCycle, authorization.publicationCycle),
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
  return providerTruthCancellationFact(input, internal.id)
}

/**
 * One exact targeted GET can settle a quarantined pre-RPL workflow: live truth
 * is external/unknown, absence proves a fresh manager authorization is
 * required. In both cases, never send the legacy Reply automatically.
 */
async function settleLegacyUnattributedAttempt(
  tx: Tx,
  input: RecordGoogleReplyObservation,
  internal: InternalReplyRow,
  publicationTarget: GoogleReplyPublicationTarget,
): Promise<DomainEvent> {
  const settled = await tx
    .update(replies)
    .set(cancelledReplySet(input.observedAt))
    .where(
      and(
        eq(replies.id, internal.id),
        eq(replies.organizationId, input.organizationId),
        eq(replies.publicationCycle, publicationTarget.publicationCycle),
        eq(replies.publicationAttempts, publicationTarget.attemptNumber),
        inArray(replies.status, [...CLAIMABLE_PUBLICATION_STATUSES]),
        inArray(replies.publicationState, [...UNCERTAIN_PUBLICATION_STATES]),
      ),
    )
    .returning({ id: replies.id })
  if (!settled[0]) {
    throw reviewError(
      'invalid_transition',
      'Legacy publication changed while recording provider truth',
    )
  }
  return providerTruthCancellationFact(input, internal.id)
}

/** The only path that may publish a local Reply: an exact, current provider
 * observation of the text this attempt wrote. */
async function confirmReplyOnGoogle(
  tx: Tx,
  input: RecordGoogleReplyObservation,
  internal: InternalReplyRow,
  attempt: PublicationAttemptRow,
  observationRevision: number,
): Promise<DomainEvent> {
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
        inArray(replies.status, [...CLAIMABLE_PUBLICATION_STATUSES]),
        inArray(replies.publicationState, [...UNCERTAIN_PUBLICATION_STATES, 'terminal']),
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
  return reviewReplyPublished({
    replyId: replyId(internal.id),
    reviewId: input.reviewId,
    propertyId: input.propertyId,
    organizationId: input.organizationId,
    userId: null,
    authorId: internal.createdBy ? userId(internal.createdBy) : null,
    occurredAt: input.observedAt,
  })
}

type ObservationDecision = ReturnType<typeof decideGoogleReplyObservation>

/** Append the new observation and replace the Review's head with it. */
/**
 * A re-read that restates the current head has nothing to say: it emits no
 * fact (see the `!== 'unchanged'` gate in `record`), confirms no attempt, and
 * supersedes none. Advancing the head for it is not free — downstream permits
 * are scoped to the EXACT current observation, so a redundant read silently
 * revoked a close permit whose fact had not been consumed yet, and nothing
 * re-issued it. A single snapshot run re-reads every review in its
 * confirmation scan, which stranded Review Inbox items on published replies.
 *
 * ONLY a snapshot re-read qualifies. A targeted reconciliation read exists to
 * move the fence a publication re-claim is measured against ("permits a
 * sending re-claim only after a newer targeted absence observation"), so it
 * must advance the head even when it observes exactly what the head says.
 */
function restatesCurrentHead(
  args: Readonly<{
    input: RecordGoogleReplyObservation
    decision: ObservationDecision
    head: ObservationHeadRow | undefined
    supersedes: boolean
    evidence: PublicationEvidence
  }>,
): boolean {
  const { input, decision, head, supersedes, evidence } = args
  if (head === undefined) return false
  if (input.source !== 'provider_snapshot') return false
  if (decision.resolution !== 'unchanged') return false
  if (supersedes || settlesLegacyUnattributedAttempt(evidence)) return false
  return (
    head.state === decision.state &&
    head.normalizedDigest === decision.normalizedDigest &&
    head.sourceEpoch === input.sourceEpoch &&
    head.materialReviewRevision === input.materialReviewRevision
  )
}

async function persistObservationAndHead(
  tx: Tx,
  input: RecordGoogleReplyObservation,
  inputDigest: string,
  decision: ObservationDecision,
  head: ObservationHeadRow | undefined,
  observationRevision: number,
): Promise<ObservationRow> {
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
  return observation
}

/**
 * Settle whichever local publication this provider truth closes. At most one
 * of the three rules can apply to a given Reply, so the last fact assigned is
 * the fact recorded.
 */
async function settleSupersededPublication(
  tx: Tx,
  input: RecordGoogleReplyObservation,
  evidence: PublicationEvidence,
  supersedes: boolean,
): Promise<DomainEvent | null> {
  const { internal, attempt, zeroAttemptAuthorization } = evidence
  let fact: DomainEvent | null = null
  if (supersedes && internal && attempt) {
    fact = await supersedeExternalCurrentAttempt(tx, input, internal, attempt)
  }
  if (zeroAttemptAuthorization && internal) {
    fact = await cancelZeroAttemptAuthorization(
      tx,
      input,
      internal,
      zeroAttemptAuthorization,
    )
  }
  if (settlesLegacyUnattributedAttempt(evidence)) {
    fact = await settleLegacyUnattributedAttempt(
      tx,
      input,
      evidence.internal,
      evidence.publicationTarget,
    )
  }
  return fact
}

/** PostgreSQL observation authority. One review-scoped advisory lock serializes
 * history revision allocation, head replacement, reply confirmation, and
 * both durable facts. */
export const createGoogleReplyObservationStore = (
  db: Database,
  events: EventBus,
): GoogleReplyObservationStore => {
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
        assertObservationFence(input)
        const inputDigest = googleReplyObservationInputDigest(input)

        const committed = await db.transaction(async (tx) => {
          await lockReplyTruthScope(tx, input.organizationId, input.reviewId)

          const review = await lockObservationSubject(tx, input)
          const replayed = await findReplayedObservation(tx, input, inputDigest)
          if (replayed) {
            return {
              result: resultFromRow(replayed, true),
              facts: [] as DomainEvent[],
            }
          }

          // New evidence still has to satisfy the current source fences.
          if (
            review.sourceEpoch !== input.sourceEpoch ||
            review.sourceRevision !== input.materialReviewRevision
          ) {
            throw reviewError(
              'invalid_transition',
              'Google reply observation is stale for the current Review source',
            )
          }

          const headRows = await selectCurrentHead(tx, input)
          const head = headRows[0]
          if (head && input.readGeneration <= head.readGeneration) {
            throw reviewError(
              'invalid_transition',
              'Google reply observation was superseded by a newer provider read',
            )
          }

          const evidence = await loadPublicationEvidence(tx, input)
          const { internal, attempt } = evidence
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
          const supersedes = supersedesCurrentAttempt(
            decision.resolution,
            candidate,
            input,
          )

          if (restatesCurrentHead({ input, decision, head, supersedes, evidence })) {
            const current = await selectHeadObservation(tx, input)
            if (current) {
              return { result: resultFromRow(current, true), facts: [] as DomainEvent[] }
            }
          }

          const observationRevision = (head?.observationRevision ?? 0) + 1
          if (!Number.isSafeInteger(observationRevision)) {
            throw reviewError('invalid_transition', 'Observation revision exhausted')
          }

          const observation = await persistObservationAndHead(
            tx,
            input,
            inputDigest,
            decision,
            head,
            observationRevision,
          )

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

          const cancellationFact = await settleSupersededPublication(
            tx,
            input,
            evidence,
            supersedes,
          )

          const facts: DomainEvent[] = []
          if (cancellationFact) facts.push(cancellationFact)
          if (decision.resolution === 'confirmed_on_google' && internal && attempt) {
            facts.push(
              await confirmReplyOnGoogle(
                tx,
                input,
                internal,
                attempt,
                observationRevision,
              ),
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
