// Atomic reply command store (BQC-3.3).
//
// One PostgreSQL transaction: reply/review state mutation + outbox_events
// insert. After commit: in-process EventBus emit for expand-phase legacy
// consumers.
//
// Crash contract:
// - Crash anywhere inside the transaction rolls back BOTH the state mutation
//   and the outbox row — no state/outbox split is ever observable.
// - Crash after commit but before the bus emit leaves a durable outbox row
//   for the relay; the emit is best-effort (failure-isolated, logged).
// - A guarded transition that matches no row (lost TOCTOU race) records no
//   outbox row and emits nothing — the caller sees null, exactly as with
//   ReplyRepository.conditionalUpdate today.
//
// BQC-3.8: the publication state machine is persisted here. Publication
// transitions guard on BOTH status and publication_state; the target state
// comes from nextPublicationState (the domain authority), never from a
// caller-supplied literal.

import { and, eq, inArray, sql } from 'drizzle-orm'
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
import type { OrganizationId, ReviewId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type { Reply } from '../domain/types'
import { reviewError } from '../domain/errors'
import { denyLegacyReviewDestruction } from '../application/review-lifecycle-safety'
import {
  AMBIGUOUS_RECONCILE_DELAY_MS,
  PROVIDER_OBSERVATION_RECONCILE_DELAY_MS,
  nextPublicationCycle,
  nextPublicationState,
  type PersistedPublicationState,
  type PublicationStateEvent,
} from '../domain/reply-publication-workflow'
import { replyFromRow, replyToRow } from './mappers/reply.mapper'
import { buildReplySetClause } from './reply-set-clause'
import type {
  ConditionalReplyUpdate,
  ReplyRepository,
} from '../application/ports/reply.repository'
import type { ReplyCommandStore } from '../application/ports/reply-command-store.port'
import type { PublicationAuthorizationFacts } from '../application/ports/reply-command-store.port'
import { googleReplyTextDigest } from '../domain/google-reply-observation'
import { lockReplyTruthScope } from './reply-truth-serialization'
import { reviewReplyPublicationCancelled } from '../domain/events'

/**
 * Identity-owned, transaction-bound decision injected at composition. The
 * callback must lock the actor's current permission generation plus the
 * membership/grant rows it uses; Review invokes it inside the same command
 * transaction that authorizes or claims the provider write.
 */
export type ReplyPublicationActorAuthority = (
  tx: Tx,
  input: Readonly<{
    organizationId: string
    propertyId: string
    userId: string
    at: Date
  }>,
) => Promise<boolean>

const missingPublicationActorAuthority: ReplyPublicationActorAuthority = async () => {
  throw reviewError('build_config_error', 'Reply publication actor authority is required')
}

async function assertAiDraftBinding(
  tx: Tx,
  reply: Reply,
): Promise<'current' | 'not_ai' | 'stale'> {
  if (!reply.aiGenerated) return 'not_ai'
  const result = await tx.execute(
    sql`SELECT assert_current_ai_draft_binding_v1(
      ${reply.organizationId},
      ${reply.id}
    ) AS "status"`,
  )
  const status = result.rows[0]?.status
  if (status === 'current' || status === 'not_ai' || status === 'stale') {
    return status
  }
  throw new Error('AI reply binding assertion returned an invalid status')
}

/**
 * Guarded reply update inside a transaction. Applies only while the row's
 * status is still the one the use case read (`reply.status`) — identical
 * TOCTOU semantics to ReplyRepository.conditionalUpdate.
 */
async function guardedReplyUpdate(
  tx: Tx,
  reply: Reply,
  updates: ConditionalReplyUpdate,
  occurredAt: Date,
): Promise<Reply | null> {
  const result = await tx
    .update(replies)
    .set(buildReplySetClause(updates, occurredAt))
    .where(
      and(
        eq(replies.id, reply.id),
        eq(replies.organizationId, reply.organizationId),
        inArray(replies.status, [reply.status]),
        eq(replies.publicationCycle, reply.publicationCycle),
      ),
    )
    .returning()
  // No row matched → status changed concurrently, TOCTOU guard triggered.
  return result[0] ? replyFromRow(result[0]) : null
}

/**
 * BQC-3.8: guarded publication update. Applies only while the row still has
 * the expected status AND one of `allowedStates` — the atomic backstop for
 * the cancellation race (a disconnect cancel moves the row out of every
 * publication-active state, so any racing publication write misses).
 */
async function guardedPublicationUpdate(
  run: Pick<Database, 'update'>,
  reply: Reply,
  expectedStatus: Reply['status'],
  allowedStates: ReadonlyArray<PersistedPublicationState>,
  set: Record<string, unknown>,
): Promise<Reply | null> {
  const result = await run
    .update(replies)
    .set(set)
    .where(
      and(
        eq(replies.id, reply.id),
        eq(replies.organizationId, reply.organizationId),
        eq(replies.status, expectedStatus),
        eq(replies.stateRevision, reply.stateRevision),
        eq(replies.publicationCycle, reply.publicationCycle),
        inArray(replies.publicationState, [...allowedStates]),
      ),
    )
    .returning()
  return result[0] ? replyFromRow(result[0]) : null
}

/**
 * Domain-authority pre-check on the read state (BQC-3.8). The SQL guard is
 * the real TOCTOU protection; this catches an impossible transition before
 * the write is even attempted. Returns the target state or null.
 */
function nextStateOrNull(
  reply: Reply,
  event: PublicationStateEvent,
): PersistedPublicationState | null {
  return nextPublicationState(reply.publicationState, event)
}

function assertPublicationIntentMatchesCycle(
  reply: Reply,
  facts: Pick<PublicationAuthorizationFacts, 'publicationIntent'> &
    Readonly<{
      lifecycleEvent?: Readonly<{
        replyId: Reply['id']
        reviewId: Reply['reviewId']
        organizationId: Reply['organizationId']
        propertyId: string
        userId: string | null
      }> | null
    }>,
): number {
  const nextCycle = nextPublicationCycle(reply.publicationCycle)
  const intent = facts.publicationIntent
  if (
    intent.replyId !== reply.id ||
    intent.reviewId !== reply.reviewId ||
    intent.organizationId !== reply.organizationId ||
    typeof intent.userId !== 'string' ||
    intent.userId.trim().length === 0 ||
    intent.publicationCycle !== nextCycle ||
    (facts.lifecycleEvent != null &&
      (facts.lifecycleEvent.replyId !== reply.id ||
        facts.lifecycleEvent.reviewId !== reply.reviewId ||
        facts.lifecycleEvent.organizationId !== reply.organizationId ||
        facts.lifecycleEvent.propertyId !== intent.propertyId ||
        facts.lifecycleEvent.userId !== intent.userId)) ||
    !Number.isSafeInteger(intent.sourceEpoch) ||
    intent.sourceEpoch < 0 ||
    !Number.isSafeInteger(intent.materialReviewRevision) ||
    intent.materialReviewRevision < 1 ||
    !Number.isSafeInteger(intent.baseObservationRevision) ||
    intent.baseObservationRevision < 0
  ) {
    throw reviewError(
      'invalid_transition',
      'Reply publication intent does not match the authorized cycle',
    )
  }
  return nextCycle
}

type LockedReplyTruthScope = Readonly<{
  review: Readonly<{
    propertyId: string
    sourceEpoch: number
    materialReviewRevision: number
    sourceContentState: string
  }>
  head: Readonly<{
    observationRevision: number
    sourceEpoch: number
    materialReviewRevision: number
    state: string
    source: string
    contentState: string
    observedAt: Date
  }> | null
}>

async function lockCurrentReplyTruthScope(
  tx: Tx,
  input: Readonly<{
    organizationId: Reply['organizationId']
    reviewId: Reply['reviewId']
    propertyId: string
  }>,
): Promise<LockedReplyTruthScope | null> {
  await lockReplyTruthScope(tx, input.organizationId, input.reviewId)
  const reviewRows = await tx
    .select({
      propertyId: reviews.propertyId,
      sourceEpoch: reviews.sourceEpoch,
      materialReviewRevision: reviews.sourceRevision,
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
  if (!review) return null

  const headRows = await tx
    .select({
      observationRevision: googleReplyObservationHeads.observationRevision,
      sourceEpoch: googleReplyObservationHeads.sourceEpoch,
      materialReviewRevision: googleReplyObservationHeads.materialReviewRevision,
      state: googleReplyObservationHeads.state,
      source: googleReplyObservations.source,
      contentState: googleReplyObservations.contentState,
      observedAt: googleReplyObservations.observedAt,
    })
    .from(googleReplyObservationHeads)
    .innerJoin(
      googleReplyObservations,
      eq(googleReplyObservations.id, googleReplyObservationHeads.observationId),
    )
    .where(
      and(
        eq(googleReplyObservationHeads.reviewId, input.reviewId),
        eq(googleReplyObservationHeads.organizationId, input.organizationId),
        eq(googleReplyObservationHeads.propertyId, input.propertyId),
      ),
    )
    .for('update', { of: googleReplyObservationHeads })
    .limit(1)

  return { review, head: headRows[0] ?? null }
}

function authorizationFenceIsCurrent(
  fence: Readonly<{
    sourceEpoch: number
    materialReviewRevision: number
    baseObservationRevision: number
  }>,
  scope: LockedReplyTruthScope,
): boolean {
  const { review, head } = scope
  return (
    review.sourceContentState === 'active' &&
    review.sourceEpoch === fence.sourceEpoch &&
    review.materialReviewRevision === fence.materialReviewRevision &&
    (head === null
      ? fence.baseObservationRevision === 0
      : head.observationRevision === fence.baseObservationRevision &&
        head.sourceEpoch === fence.sourceEpoch &&
        head.materialReviewRevision === fence.materialReviewRevision &&
        head.contentState === 'active')
  )
}

type PublicationAttemptStart = Parameters<ReplyCommandStore['markPublicationSending']>[1]
type PublicationAuthorizationRow = typeof replyPublicationAuthorizations.$inferSelect

/** Update the attempt row the Reply currently points at. Its absence means the
 * append-only publication evidence and the Reply have diverged. */
const updateCurrentAttempt = async (
  tx: Tx,
  reply: Reply,
  set: Record<string, unknown>,
): Promise<void> => {
  const rows = await tx
    .update(replyPublicationAttempts)
    .set(set)
    .where(
      and(
        eq(replyPublicationAttempts.replyId, reply.id),
        eq(replyPublicationAttempts.organizationId, reply.organizationId),
        eq(replyPublicationAttempts.publicationCycle, reply.publicationCycle),
        eq(replyPublicationAttempts.attemptNumber, reply.publicationAttempts),
      ),
    )
    .returning({ id: replyPublicationAttempts.id })
  if (!rows[0]) {
    throw reviewError(
      'invalid_transition',
      'Reply publication attempt evidence is missing',
    )
  }
}

function selectPriorPublicationAttempt(tx: Tx, reply: Reply) {
  return tx
    .select({
      baseObservationRevision: replyPublicationAttempts.baseObservationRevision,
      sourceEpoch: replyPublicationAttempts.sourceEpoch,
      materialReviewRevision: replyPublicationAttempts.materialReviewRevision,
      replyStateRevision: replyPublicationAttempts.replyStateRevision,
      expectedReplyDigest: replyPublicationAttempts.expectedReplyDigest,
      createdAt: replyPublicationAttempts.createdAt,
    })
    .from(replyPublicationAttempts)
    .where(
      and(
        eq(replyPublicationAttempts.organizationId, reply.organizationId),
        eq(replyPublicationAttempts.reviewId, reply.reviewId),
        eq(replyPublicationAttempts.replyId, reply.id),
        eq(replyPublicationAttempts.publicationCycle, reply.publicationCycle),
        eq(replyPublicationAttempts.attemptNumber, reply.publicationAttempts),
      ),
    )
    .limit(1)
}

type PriorPublicationAttemptRow = Awaited<
  ReturnType<typeof selectPriorPublicationAttempt>
>[number]

/** Only an in-flight re-claim has a prior attempt to be fenced against. */
async function readPriorPublicationAttempt(
  tx: Tx,
  reply: Reply,
): Promise<PriorPublicationAttemptRow | undefined> {
  if (reply.publicationState !== 'sending' || reply.publicationAttempts <= 0) {
    return undefined
  }
  const rows = await selectPriorPublicationAttempt(tx, reply)
  return rows[0]
}

/**
 * The stored authorization for this cycle, but only while it still describes
 * the reply text, the manager-observed source, and the locked provider truth
 * this attempt claims. Anything else means the authorization is no longer the
 * one being executed, and the claim must not proceed.
 */
async function readCurrentPublicationAuthorization(
  tx: Tx,
  reply: Reply,
  attempt: PublicationAttemptStart,
  scope: LockedReplyTruthScope,
): Promise<PublicationAuthorizationRow | null> {
  const authorizationRows = await tx
    .select()
    .from(replyPublicationAuthorizations)
    .where(
      and(
        eq(replyPublicationAuthorizations.organizationId, reply.organizationId),
        eq(replyPublicationAuthorizations.propertyId, attempt.propertyId),
        eq(replyPublicationAuthorizations.reviewId, reply.reviewId),
        eq(replyPublicationAuthorizations.replyId, reply.id),
        eq(replyPublicationAuthorizations.publicationCycle, reply.publicationCycle),
      ),
    )
    .limit(1)
  const authorization = authorizationRows[0]
  if (
    !authorization ||
    authorization.sourceEpoch !== attempt.sourceEpoch ||
    authorization.materialReviewRevision !== attempt.materialReviewRevision ||
    authorization.baseObservationRevision !== attempt.baseObservationRevision ||
    googleReplyTextDigest(reply.text) !== authorization.expectedReplyDigest ||
    scope.review.sourceContentState !== 'active' ||
    scope.review.sourceEpoch !== authorization.sourceEpoch ||
    scope.review.materialReviewRevision !== authorization.materialReviewRevision ||
    (scope.head !== null &&
      (scope.head.sourceEpoch !== authorization.sourceEpoch ||
        scope.head.materialReviewRevision !== authorization.materialReviewRevision ||
        scope.head.contentState !== 'active'))
  ) {
    return null
  }
  return authorization
}

/**
 * A first claim must start from exactly the observation head the manager
 * authorized. A re-claim of an uncertain `sending` row may only proceed when a
 * targeted read, taken after that attempt, proved the provider currently holds
 * no reply for the same source and the same authorized text.
 */
function claimObservationFenceIsCurrent(
  reply: Reply,
  attempt: PublicationAttemptStart,
  authorization: PublicationAuthorizationRow,
  head: LockedReplyTruthScope['head'],
  priorAttempt: PriorPublicationAttemptRow | undefined,
): boolean {
  if (reply.publicationState === 'authorized') {
    return (head?.observationRevision ?? 0) === authorization.baseObservationRevision
  }
  if (reply.publicationState !== 'sending') return true
  return (
    priorAttempt !== undefined &&
    head !== null &&
    head.state === 'absent' &&
    head.source === 'targeted_reconciliation' &&
    head.contentState === 'active' &&
    head.sourceEpoch === attempt.sourceEpoch &&
    head.materialReviewRevision === attempt.materialReviewRevision &&
    head.observationRevision > priorAttempt.baseObservationRevision &&
    head.observedAt.getTime() >= priorAttempt.createdAt.getTime() &&
    priorAttempt.sourceEpoch === attempt.sourceEpoch &&
    priorAttempt.materialReviewRevision === attempt.materialReviewRevision &&
    priorAttempt.replyStateRevision === authorization.replyStateRevision &&
    priorAttempt.expectedReplyDigest === authorization.expectedReplyDigest
  )
}

/** The named manager has lost current authority: move the cycle to
 * draft/cancelled in this same transaction so a consumed job never strands an
 * authorized Reply. Returns the durable cancellation fact, or null when the row
 * was no longer claimable. */
async function cancelPublicationForLostAuthority(
  tx: Tx,
  reply: Reply,
  attempt: PublicationAttemptStart,
  at: Date,
): Promise<DomainEvent | null> {
  const cancelled = await guardedPublicationUpdate(
    tx,
    reply,
    'approved',
    ['authorized', 'sending'],
    {
      status: 'draft',
      publicationState: 'cancelled',
      updatedAt: at,
    },
  )
  if (!cancelled) return null
  if (cancelled.publicationAttempts > 0) {
    await updateCurrentAttempt(tx, cancelled, {
      outcome: 'superseded',
      confirmedObservationRevision: null,
      updatedAt: at,
    })
  }
  const fact = reviewReplyPublicationCancelled({
    replyId: cancelled.id,
    reviewId: cancelled.reviewId,
    propertyId: attempt.propertyId,
    organizationId: cancelled.organizationId,
    cause: 'policy',
    occurredAt: at,
  })
  await insertOutboxRow(tx, fact)
  return fact
}

export const createAtomicReplyCommandStore = (
  db: Database,
  events: EventBus,
  clock: () => Date,
  publicationActorAuthority: ReplyPublicationActorAuthority = missingPublicationActorAuthority,
): ReplyCommandStore => {
  /** Shared runner for the guarded-transition commands. */
  const transition = async (
    span: string,
    reply: Reply,
    updates: ConditionalReplyUpdate,
    event: DomainEvent | null,
    now?: Date,
  ): Promise<Reply | null> => {
    return trace(span, async () => {
      const occurredAt = now ?? clock()
      const saved = await db.transaction(async (tx) => {
        if ((await assertAiDraftBinding(tx, reply)) === 'stale') return null
        const row = await guardedReplyUpdate(tx, reply, updates, occurredAt)
        if (!row) return null
        if (event) await insertOutboxRow(tx, event)
        return row
      })
      if (saved && event) await emitAfterCommit(events, event)
      return saved
    })
  }

  /** BQC-3.8: guarded publication transition + optional fact, one tx. */
  const publicationTransition = async (
    span: string,
    reply: Reply,
    event: PublicationStateEvent,
    allowedStates: ReadonlyArray<PersistedPublicationState>,
    set: (target: PersistedPublicationState, now: Date) => Record<string, unknown>,
    fact: DomainEvent | null,
    now?: Date,
    afterWrite?: (tx: Tx, saved: Reply, at: Date) => Promise<void>,
  ): Promise<Reply | null> => {
    return trace(span, async () => {
      const target = nextStateOrNull(reply, event)
      if (!target) return null
      const at = now ?? clock()
      const saved = await db.transaction(async (tx) => {
        const row = await guardedPublicationUpdate(
          tx,
          reply,
          reply.status,
          allowedStates,
          set(target, at),
        )
        if (!row) return null
        if (afterWrite) await afterWrite(tx, row, at)
        if (fact) await insertOutboxRow(tx, fact)
        return row
      })
      if (saved && fact) await emitAfterCommit(events, fact)
      return saved
    })
  }

  const mirrorUpsert = async (
    tx: Tx,
    replyToUpsert: Omit<Reply, 'createdAt' | 'updatedAt'>,
    now?: Date,
  ) => {
    const row = replyToRow(replyToUpsert)
    const updatedAt = now ?? clock()
    const result = await tx
      .insert(replies)
      .values(row)
      .onConflictDoUpdate({
        target: [replies.reviewId, replies.source, replies.organizationId],
        set: {
          text: row.text,
          status: row.status,
          approvedBy: row.approvedBy,
          rejectedBy: row.rejectedBy,
          rejectionReason: row.rejectionReason,
          aiGenerated: row.aiGenerated,
          stateRevision: row.stateRevision,
          submittedAt: row.submittedAt,
          approvedAt: row.approvedAt,
          publishedAt: row.publishedAt,
          // BQC-3.8: publication columns are deliberately NOT in the conflict
          // set — a mirror refresh never clobbers an in-flight publication.
          updatedAt,
        },
      })
      .returning()
    if (!result[0]) {
      throw reviewError(
        'repo_upsert_failed',
        'Reply mirror upsert failed — no row returned',
      )
    }
    return replyFromRow(result[0])
  }

  return {
    submitReply: (reply, updates, event, now) =>
      transition('reply.commandStore.submitReply', reply, updates, event, now),
    rejectReply: (reply, updates, event, now) =>
      transition('reply.commandStore.rejectReply', reply, updates, event, now),
    // BQC-3.8: publish also persists publication_state='published' and clears
    // the reconcile schedule — provider confirmation is authoritative.
    markPublished: (reply, updates, event, now) =>
      transition(
        'reply.commandStore.markPublished',
        reply,
        { ...updates, publicationState: 'published', reconcileDueAt: null },
        event,
        now,
      ),

    // BQC-3.8: authorize = approve/retry re-authorization (new publication
    // cycle): guarded status update + authorized state + cycle reset + the
    // approved fact when one is supplied — one transaction.
    markPublicationAuthorized: (reply, updates, facts, now) => {
      if (!nextStateOrNull(reply, 'authorize')) return Promise.resolve(null)
      const publicationCycle = assertPublicationIntentMatchesCycle(reply, facts)
      const occurredAt = now ?? clock()
      return trace('reply.commandStore.markPublicationAuthorized', async () => {
        const saved = await db.transaction(async (tx) => {
          const intent = facts.publicationIntent
          const scope = await lockCurrentReplyTruthScope(tx, {
            organizationId: reply.organizationId,
            reviewId: reply.reviewId,
            propertyId: intent.propertyId,
          })
          if (!scope || !authorizationFenceIsCurrent(intent, scope)) return null
          const actorAllowed = await publicationActorAuthority(tx, {
            organizationId: reply.organizationId,
            propertyId: intent.propertyId,
            userId: intent.userId,
            at: occurredAt,
          })
          if (!actorAllowed) return null
          if ((await assertAiDraftBinding(tx, reply)) === 'stale') return null
          const row = await guardedReplyUpdate(
            tx,
            reply,
            {
              ...updates,
              publicationState: 'authorized',
              publicationCycle,
              publicationAttempts: 0,
              publicationLastErrorClass: null,
              reconcileDueAt: null,
            },
            occurredAt,
          )
          if (!row) return null
          await tx.insert(replyPublicationAuthorizations).values({
            organizationId: reply.organizationId,
            propertyId: intent.propertyId,
            reviewId: reply.reviewId,
            replyId: reply.id,
            publicationCycle,
            sourceEpoch: intent.sourceEpoch,
            materialReviewRevision: intent.materialReviewRevision,
            baseObservationRevision: intent.baseObservationRevision,
            authorizedByUserId: intent.userId,
            replyStateRevision: row.stateRevision,
            normalizationVersion: 'google-reply-v1',
            expectedReplyDigest: googleReplyTextDigest(row.text),
            authorizedAt: occurredAt,
            createdAt: occurredAt,
          })
          if (facts.lifecycleEvent) await insertOutboxRow(tx, facts.lifecycleEvent)
          await insertOutboxRow(tx, facts.publicationIntent)
          return row
        })
        if (saved && facts.lifecycleEvent) {
          await emitAfterCommit(events, facts.lifecycleEvent)
        }
        return saved
      })
    },

    // BQC-3.8/RPL-01: claim. The normal claim records no fact. If the named
    // manager has lost current authority, the same transaction instead moves
    // the cycle to draft/cancelled and records publication_cancelled(policy),
    // so a consumed job never strands an authorized Reply.
    markPublicationSending: async (reply, attempt, now) => {
      return trace('reply.commandStore.markPublicationSending', async () => {
        const target = nextStateOrNull(reply, 'claim')
        if (!target) return null
        if (
          attempt.providerOperationKey.length < 1 ||
          attempt.providerOperationKey.length > 255 ||
          attempt.sourceEpoch < 0 ||
          !Number.isSafeInteger(attempt.sourceEpoch) ||
          attempt.materialReviewRevision < 1 ||
          !Number.isSafeInteger(attempt.materialReviewRevision) ||
          attempt.baseObservationRevision < 0 ||
          !Number.isSafeInteger(attempt.baseObservationRevision)
        ) {
          throw reviewError('invalid_input', 'Invalid publication attempt fence')
        }
        const at = now ?? clock()
        let authorityCancellation: DomainEvent | null = null
        const claimed = await db.transaction(async (tx) => {
          const scope = await lockCurrentReplyTruthScope(tx, {
            organizationId: reply.organizationId,
            reviewId: reply.reviewId,
            propertyId: attempt.propertyId,
          })
          if (!scope) return null
          if ((await assertAiDraftBinding(tx, reply)) === 'stale') return null
          const authorization = await readCurrentPublicationAuthorization(
            tx,
            reply,
            attempt,
            scope,
          )
          if (!authorization) return null
          const actorAllowed = await publicationActorAuthority(tx, {
            organizationId: authorization.organizationId,
            propertyId: authorization.propertyId,
            userId: authorization.authorizedByUserId,
            at,
          })
          if (!actorAllowed) {
            authorityCancellation = await cancelPublicationForLostAuthority(
              tx,
              reply,
              attempt,
              at,
            )
            return null
          }
          const duplicate = await tx
            .select({ id: replyPublicationAttempts.id })
            .from(replyPublicationAttempts)
            .where(
              and(
                eq(replyPublicationAttempts.organizationId, reply.organizationId),
                eq(
                  replyPublicationAttempts.providerOperationKey,
                  attempt.providerOperationKey,
                ),
              ),
            )
            .limit(1)
          if (duplicate[0]) return null

          const priorAttempt = await readPriorPublicationAttempt(tx, reply)
          const head = scope.head
          if (
            !claimObservationFenceIsCurrent(
              reply,
              attempt,
              authorization,
              head,
              priorAttempt,
            )
          ) {
            return null
          }
          const claimed = await guardedPublicationUpdate(
            tx,
            reply,
            'approved',
            ['authorized', 'sending'],
            {
              publicationState: target,
              publicationAttempts: sql`${replies.publicationAttempts} + 1`,
              updatedAt: at,
            },
          )
          if (!claimed) return null
          if (reply.publicationState === 'sending' && reply.publicationAttempts > 0) {
            await updateCurrentAttempt(tx, reply, {
              outcome: 'ambiguous',
              updatedAt: at,
            })
          }
          await tx.insert(replyPublicationAttempts).values({
            organizationId: reply.organizationId,
            propertyId: attempt.propertyId,
            reviewId: reply.reviewId,
            replyId: reply.id,
            publicationCycle: reply.publicationCycle,
            attemptNumber: claimed.publicationAttempts,
            providerOperationKey: attempt.providerOperationKey,
            sourceEpoch: authorization.sourceEpoch,
            materialReviewRevision: authorization.materialReviewRevision,
            replyStateRevision: authorization.replyStateRevision,
            baseObservationRevision: head?.observationRevision ?? 0,
            normalizationVersion: authorization.normalizationVersion,
            expectedReplyDigest: authorization.expectedReplyDigest,
            outcome: 'sending',
            createdAt: at,
            updatedAt: at,
          })
          return claimed
        })
        if (authorityCancellation) {
          await emitAfterCommit(events, authorityCancellation)
        }
        return claimed
      })
    },

    markProviderOutcomePendingObservation: (reply, outcome, now) =>
      publicationTransition(
        'reply.commandStore.markProviderOutcomePendingObservation',
        reply,
        'provider_accepted',
        ['sending'],
        (target, at) => ({
          publicationState: target,
          reconcileDueAt: new Date(
            at.getTime() + PROVIDER_OBSERVATION_RECONCILE_DELAY_MS,
          ),
          updatedAt: at,
        }),
        null,
        now,
        (tx, saved, at) =>
          updateCurrentAttempt(tx, saved, {
            outcome: 'provider_outcome_pending',
            providerCorrelationId: outcome.providerCorrelationId,
            providerRespondedAt: outcome.providerRespondedAt,
            updatedAt: at,
          }),
      ),

    markPublicationTerminal: (reply, errorClass, event, now) =>
      publicationTransition(
        'reply.commandStore.markPublicationTerminal',
        reply,
        'fail_terminal',
        ['sending'],
        (target, at) => ({
          status: 'publish_failed',
          publicationState: target,
          publicationLastErrorClass: errorClass,
          updatedAt: at,
        }),
        event,
        now,
        (tx, saved, at) =>
          updateCurrentAttempt(tx, saved, {
            outcome: 'terminal_rejection',
            updatedAt: at,
          }),
      ),

    markPublicationAmbiguous: (reply, event, now) =>
      publicationTransition(
        'reply.commandStore.markPublicationAmbiguous',
        reply,
        'fail_ambiguous',
        ['sending'],
        (target, at) => ({
          status: 'publish_failed',
          publicationState: target,
          publicationLastErrorClass: 'ambiguous',
          reconcileDueAt: new Date(at.getTime() + AMBIGUOUS_RECONCILE_DELAY_MS),
          updatedAt: at,
        }),
        event,
        now,
        (tx, saved, at) =>
          updateCurrentAttempt(tx, saved, {
            outcome: 'ambiguous',
            updatedAt: at,
          }),
      ),

    // BQC-3.8: retryable failure — back to 'authorized' (next attempt or
    // quarantine redrive re-claims); last_error_class/attempts preserved.
    markPublicationRetryQueued: async (reply, now) => {
      return trace('reply.commandStore.markPublicationRetryQueued', async () => {
        const target = nextStateOrNull(reply, 'requeue')
        if (!target) return null
        const occurredAt = now ?? clock()
        return db.transaction(async (tx) => {
          const saved = await guardedPublicationUpdate(
            tx,
            reply,
            'approved',
            ['sending'],
            {
              publicationState: target,
              updatedAt: occurredAt,
            },
          )
          if (!saved) return null
          await updateCurrentAttempt(tx, saved, {
            outcome: 'retryable_failure',
            updatedAt: occurredAt,
          })
          return saved
        })
      })
    },

    // Edit-and-republish: guarded status='published' → 'approved' with the new
    // text + a fresh publication cycle + the review.reply.updated fact — one
    // transaction. The guard: the row must still be published (a purge,
    // cancellation, or concurrent edit since the user opened the editor loses
    // the race — no fact, no mutation, the caller surfaces invalid_transition).
    editPublishedReply: (reply, command) => {
      if (reply.status !== 'published') return Promise.resolve(null)
      const publicationCycle = assertPublicationIntentMatchesCycle(reply, command)
      const occurredAt = command.now ?? clock()
      return trace('reply.commandStore.editPublishedReply', async () => {
        const saved = await db.transaction(async (tx) => {
          const intent = command.publicationIntent
          const scope = await lockCurrentReplyTruthScope(tx, {
            organizationId: reply.organizationId,
            reviewId: reply.reviewId,
            propertyId: intent.propertyId,
          })
          if (!scope || !authorizationFenceIsCurrent(intent, scope)) return null
          const actorAllowed = await publicationActorAuthority(tx, {
            organizationId: reply.organizationId,
            propertyId: intent.propertyId,
            userId: intent.userId,
            at: occurredAt,
          })
          if (!actorAllowed) return null
          if ((await assertAiDraftBinding(tx, reply)) === 'stale') return null
          const row = await guardedReplyUpdate(
            tx,
            reply,
            {
              text: command.text,
              status: 'approved',
              publicationState: 'authorized',
              publicationCycle,
              publicationAttempts: 0,
              publicationLastErrorClass: null,
              reconcileDueAt: null,
            },
            occurredAt,
          )
          if (!row) return null
          await tx.insert(replyPublicationAuthorizations).values({
            organizationId: reply.organizationId,
            propertyId: intent.propertyId,
            reviewId: reply.reviewId,
            replyId: reply.id,
            publicationCycle,
            sourceEpoch: intent.sourceEpoch,
            materialReviewRevision: intent.materialReviewRevision,
            baseObservationRevision: intent.baseObservationRevision,
            authorizedByUserId: intent.userId,
            replyStateRevision: row.stateRevision,
            normalizationVersion: 'google-reply-v1',
            expectedReplyDigest: googleReplyTextDigest(row.text),
            authorizedAt: occurredAt,
            createdAt: occurredAt,
          })
          await insertOutboxRow(tx, command.lifecycleEvent)
          await insertOutboxRow(tx, command.publicationIntent)
          return row
        })
        if (saved) await emitAfterCommit(events, command.lifecycleEvent)
        return saved
      })
    },

    cancelPublications: async (commands) => {
      return trace('reply.commandStore.cancelPublications', async () => {
        if (commands.length === 0) return 0
        const committed: DomainEvent[] = []
        const cancelled = await db.transaction(async (tx) => {
          let count = 0
          for (const { reply, event, now } of commands) {
            // Rows whose state moved on (published/failed/cancelled/purged)
            // are skipped without a fact — the batch still commits.
            if (!nextStateOrNull(reply, 'cancel')) continue
            const occurredAt = now ?? clock()
            const row = await guardedPublicationUpdate(
              tx,
              reply,
              reply.status,
              ['requested', 'authorized', 'sending', 'pending_observation'],
              {
                status: 'draft',
                publicationState: 'cancelled',
                updatedAt: occurredAt,
              },
            )
            if (!row) continue
            if (row.publicationAttempts > 0) {
              await updateCurrentAttempt(tx, row, {
                outcome: 'superseded',
                confirmedObservationRevision: null,
                updatedAt: occurredAt,
              })
            }
            await insertOutboxRow(tx, event)
            committed.push(event)
            count++
          }
          return count
        })
        for (const event of committed) await emitAfterCommit(events, event)
        return cancelled
      })
    },

    mirrorSyncedReply: async (command) => {
      return trace('reply.commandStore.mirrorSyncedReply', async () => {
        const saved = await db.transaction(async (tx) => {
          if (!command.reply) {
            // Google no longer shows a reply — remove the mirror. No fact.
            await tx
              .delete(replies)
              .where(
                and(
                  eq(replies.reviewId, command.reviewId),
                  eq(replies.source, 'google_sync'),
                  eq(replies.organizationId, command.organizationId),
                ),
              )
            return null
          }
          const mirrored = await mirrorUpsert(tx, command.reply, command.now)
          if (command.event) await insertOutboxRow(tx, command.event)
          return mirrored
        })
        if (saved && command.event) await emitAfterCommit(events, command.event)
        return saved
      })
    },

    purgeExpiredReview: async (reviewId, event) => {
      return trace('reply.commandStore.purgeExpiredReview', async () => {
        // SAFE-03: the current Review row still carries both provider content
        // and stable RepKey Reply/history identity. Its Reply FK cascades, so
        // this legacy command cannot be made safe without the REV-01 schema
        // cutover. Deny before SQL and before recording a false expiry fact.
        void reviewId
        void event
        denyLegacyReviewDestruction()
      })
    },
  }
}

/**
 * Non-transactional store for unit tests / expand-phase fakes. Applies the
 * same operation order (state → outbox → emit) without a real transaction;
 * the legacy Review purge is denied before every dependency in both stores.
 * Not for production — production must use createAtomicReplyCommandStore.
 */
export const createSequentialReplyCommandStore = (deps: {
  conditionalUpdate: ReplyRepository['conditionalUpdate']
  upsert: ReplyRepository['upsert']
  deleteByReviewIdAndSource: ReplyRepository['deleteByReviewIdAndSource']
  /** @deprecated SAFE-03 keeps this compatibility dependency unreachable. */
  deleteReviewById: (reviewId: ReviewId, organizationId: OrganizationId) => Promise<void>
  events: EventBus
  clock: () => Date
  recordOutbox?: (event: DomainEvent) => Promise<void>
  /**
   * BQC-3.8: publication-state-guarded update for the claim/cancel/requeue
   * paths (the sequential equivalent of guardedPublicationUpdate).
   */
  publicationUpdate?: (
    reply: Reply,
    allowedStates: ReadonlyArray<PersistedPublicationState>,
    updates: ConditionalReplyUpdate,
    now?: Date,
  ) => Promise<Reply | null>
}): ReplyCommandStore => {
  const recordAndEmit = async (event: DomainEvent): Promise<void> => {
    if (deps.recordOutbox) await deps.recordOutbox(event)
    await emitAfterCommit(deps.events, event)
  }

  const transition = async (
    reply: Reply,
    updates: ConditionalReplyUpdate,
    event: DomainEvent | null,
    now?: Date,
  ): Promise<Reply | null> => {
    const saved = await deps.conditionalUpdate(
      reply.id,
      reply.organizationId,
      [reply.status],
      updates,
      now,
    )
    if (saved && event) await recordAndEmit(event)
    return saved
  }

  const publicationTransition = async (
    reply: Reply,
    event: PublicationStateEvent,
    allowedStates: ReadonlyArray<PersistedPublicationState>,
    updates: ConditionalReplyUpdate,
    fact: DomainEvent | null,
    now?: Date,
  ): Promise<Reply | null> => {
    if (!nextStateOrNull(reply, event)) return null
    if (!deps.publicationUpdate) {
      throw reviewError(
        'build_config_error',
        'publicationUpdate dep is required for publication transitions',
      )
    }
    const saved = await deps.publicationUpdate(reply, allowedStates, updates, now)
    if (saved && fact) await recordAndEmit(fact)
    return saved
  }

  return {
    submitReply: (reply, updates, event, now) => transition(reply, updates, event, now),
    rejectReply: (reply, updates, event, now) => transition(reply, updates, event, now),
    markPublished: (reply, updates, event, now) =>
      transition(
        reply,
        { ...updates, publicationState: 'published', reconcileDueAt: null },
        event,
        now,
      ),

    markPublicationAuthorized: async (reply, updates, facts, now) => {
      if (!nextStateOrNull(reply, 'authorize')) return Promise.resolve(null)
      const publicationCycle = assertPublicationIntentMatchesCycle(reply, facts)
      const saved = await deps.conditionalUpdate(
        reply.id,
        reply.organizationId,
        [reply.status],
        {
          ...updates,
          publicationState: 'authorized',
          publicationCycle,
          publicationAttempts: 0,
          publicationLastErrorClass: null,
          reconcileDueAt: null,
        },
        now,
      )
      if (!saved) return null
      if (facts.lifecycleEvent && deps.recordOutbox) {
        await deps.recordOutbox(facts.lifecycleEvent)
      }
      if (deps.recordOutbox) await deps.recordOutbox(facts.publicationIntent)
      if (facts.lifecycleEvent) await emitAfterCommit(deps.events, facts.lifecycleEvent)
      return saved
    },

    markPublicationSending: (reply, _attempt, now) =>
      publicationTransition(
        reply,
        'claim',
        ['authorized', 'sending'],
        { publicationState: 'sending' },
        null,
        now,
      ),

    markProviderOutcomePendingObservation: (reply, _outcome, now) =>
      publicationTransition(
        reply,
        'provider_accepted',
        ['sending'],
        {
          publicationState: 'pending_observation',
          reconcileDueAt: new Date(
            (now ?? deps.clock()).getTime() + PROVIDER_OBSERVATION_RECONCILE_DELAY_MS,
          ),
        },
        null,
        now,
      ),

    markPublicationTerminal: (reply, errorClass, event, now) =>
      publicationTransition(
        reply,
        'fail_terminal',
        ['sending'],
        {
          status: 'publish_failed',
          publicationState: 'terminal',
          publicationLastErrorClass: errorClass,
        },
        event,
        now,
      ),

    markPublicationAmbiguous: (reply, event, now) =>
      publicationTransition(
        reply,
        'fail_ambiguous',
        ['sending'],
        {
          status: 'publish_failed',
          publicationState: 'ambiguous',
          publicationLastErrorClass: 'ambiguous',
          reconcileDueAt: new Date(
            (now ?? deps.clock()).getTime() + AMBIGUOUS_RECONCILE_DELAY_MS,
          ),
        },
        event,
        now,
      ),

    markPublicationRetryQueued: (reply, now) =>
      publicationTransition(
        reply,
        'requeue',
        ['sending'],
        { publicationState: 'authorized' },
        null,
        now,
      ),

    // Edit-and-republish: guard on the persisted published status (mirrors the
    // atomic store — the fake's conditionalUpdate enforces the TOCTOU guard).
    editPublishedReply: (reply, command) => {
      if (reply.status !== 'published') return Promise.resolve(null)
      const publicationCycle = assertPublicationIntentMatchesCycle(reply, command)
      return deps
        .conditionalUpdate(
          reply.id,
          reply.organizationId,
          [reply.status],
          {
            text: command.text,
            status: 'approved',
            publicationState: 'authorized',
            publicationCycle,
            publicationAttempts: 0,
            publicationLastErrorClass: null,
            reconcileDueAt: null,
          },
          command.now,
        )
        .then(async (saved) => {
          if (!saved) return null
          if (deps.recordOutbox) {
            await deps.recordOutbox(command.lifecycleEvent)
            await deps.recordOutbox(command.publicationIntent)
          }
          await emitAfterCommit(deps.events, command.lifecycleEvent)
          return saved
        })
    },

    cancelPublications: async (commands) => {
      let count = 0
      for (const { reply, event, now } of commands) {
        const saved = await publicationTransition(
          reply,
          'cancel',
          ['requested', 'authorized', 'sending', 'pending_observation'],
          { status: 'draft', publicationState: 'cancelled' },
          null,
          now,
        )
        if (saved) {
          await recordAndEmit(event)
          count++
        }
      }
      return count
    },

    mirrorSyncedReply: async (command) => {
      if (!command.reply) {
        await deps.deleteByReviewIdAndSource(
          command.reviewId,
          'google_sync',
          command.organizationId,
        )
        return null
      }
      const saved = await deps.upsert(command.reply, command.now)
      if (command.event) await recordAndEmit(command.event)
      return saved
    },

    purgeExpiredReview: async (reviewId, event) => {
      // Keep the non-transactional fake aligned with production safety. Tests
      // must never normalize a cascade that production deliberately denies.
      void reviewId
      void event
      denyLegacyReviewDestruction()
    },
  }
}
