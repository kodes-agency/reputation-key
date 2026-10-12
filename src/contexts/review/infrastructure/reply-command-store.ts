// Atomic reply command store (BQC-3.3).
//
// One PostgreSQL transaction commits each reply/review state mutation with its
// outbox row. A crash anywhere inside the transaction rolls back both, while a
// guarded transition that matches no row records no fact and returns null.
//
// Every write carries its command's precondition as a compare-and-set
// (reply-write-guards.ts): the snapshot must be a reply the command may start
// from, and the row must still be that snapshot. The store does not trust the
// use case to have checked, so a second entry point cannot skip the rule. The
// same guard carries what the command means for AI-assisted text
// (domain/reply-ai-text.ts): submit and approval need a current AI draft
// binding, reject and retry never read it, an edit makes the Reply
// human-authored. The claim is the last gate for AI text that was never
// claimed before, and a claim it refuses cancels the cycle.
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
import type { DomainEvent } from '#/shared/events/events'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import type { Reply } from '../domain/types'
import { reviewError } from '../domain/errors'
import { denyLegacyReviewDestruction } from '../application/review-lifecycle-safety'
import {
  AMBIGUOUS_RECONCILE_DELAY_MS,
  PROVIDER_OBSERVATION_RECONCILE_DELAY_MS,
  PUBLICATION_RECOVERY_RECONCILE_DELAY_MS,
  nextPublicationCycle,
  nextPublicationState,
  type PersistedPublicationState,
  type PublicationFailureClass,
  type PublicationStateEvent,
} from '../domain/reply-publication-workflow'
import { replyFromRow, replyToRow } from './mappers/reply.mapper'
import {
  aiTextMayBeClaimed,
  guardedPublicationUpdate,
  guardedReplyUpdate,
} from './reply-write-guards'
import {
  cancelledPublication,
  replyCommandMayStart,
  type ReplyCommand,
} from '../domain/reply-command-preconditions'
import type { ConditionalReplyUpdate } from '../application/ports/reply.repository'
import type { ReplyCommandStore } from '../application/ports/reply-command-store.port'
import type { PublicationAuthorizationFacts } from '../application/ports/reply-command-store.port'
import { googleReplyTextDigest } from '../domain/google-reply-observation'
import { lockReplyTruthScope } from './reply-truth-serialization'
import { reviewReplyPublicationCancelled } from '../domain/events'
import { replyAuthor } from '../domain/reply-author'
import { attemptMayHaveDispatched } from './reply-publication-dispatch-evidence'
import {
  lockPublicationProperty,
  propertyAdmitsCycle,
} from './publication-property-admission'

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
 * append-only publication evidence and the Reply have diverged. `fromOutcomes`
 * additionally refuses to rewrite an attempt that already reached any other
 * outcome (the transaction then rolls back with the Reply write). */
const updateCurrentAttempt = async (
  tx: Tx,
  reply: Reply,
  set: Record<string, unknown>,
  fromOutcomes?: ReadonlyArray<string>,
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
        fromOutcomes
          ? inArray(replyPublicationAttempts.outcome, [...fromOutcomes])
          : undefined,
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

/** A (status, publication_state[, last error class]) an uncertain-send command
 * may start from. */
type UncertainSendSnapshot = Readonly<{
  status: Reply['status']
  publicationState: PersistedPublicationState
  lastErrorClass?: PublicationFailureClass
}>

/** D3: only a send still in flight waits out the propagation grace. */
const DEFERRABLE_SEND: ReadonlyArray<UncertainSendSnapshot> = [
  { status: 'approved', publicationState: 'sending' },
]

/** D3: only automatic-check ambiguity moves along the read ladder. */
const LADDER_AMBIGUITY: ReadonlyArray<UncertainSendSnapshot> = [
  { status: 'publish_failed', publicationState: 'ambiguous' },
]

/** D4: every state whose attempt may or may not have reached Google. A
 * terminal row qualifies only when it is terminal ambiguity; a rejection or
 * an exhausted retry already says what happened. */
const NEVER_DISPATCHED_SETTLEABLE: ReadonlyArray<UncertainSendSnapshot> = [
  { status: 'approved', publicationState: 'sending' },
  { status: 'publish_failed', publicationState: 'ambiguous' },
  { status: 'publish_failed', publicationState: 'terminal', lastErrorClass: 'ambiguous' },
]

function uncertainSnapshotFor(
  reply: Reply,
  allowed: ReadonlyArray<UncertainSendSnapshot>,
): UncertainSendSnapshot | null {
  return (
    allowed.find(
      (snapshot) =>
        snapshot.status === reply.status &&
        snapshot.publicationState === reply.publicationState &&
        (snapshot.lastErrorClass === undefined ||
          snapshot.lastErrorClass === reply.publicationLastErrorClass),
    ) ?? null
  )
}

/** A due time in the past would put the row back into the sweep run that is
 * reading it, which is a second provider read with nothing learned. */
function assertDueAfter(dueAt: Date, now: Date): void {
  if (
    !Number.isFinite(dueAt.getTime()) ||
    !Number.isFinite(now.getTime()) ||
    dueAt.getTime() <= now.getTime()
  ) {
    throw reviewError('invalid_input', 'Reply reconciliation must be due after now')
  }
}

/**
 * D3/D4 compare-and-set for the current attempt: the row must still have the
 * snapshot's status, publication state, cycle, attempt number and state
 * revision (and, for terminal ambiguity, its last error class). A later
 * attempt, a new cycle, a heal, a cancellation or another settlement all miss.
 */
function uncertainAttemptWhere(reply: Reply, snapshot: UncertainSendSnapshot) {
  return and(
    eq(replies.id, reply.id),
    eq(replies.organizationId, reply.organizationId),
    eq(replies.status, snapshot.status),
    eq(replies.publicationState, snapshot.publicationState),
    eq(replies.publicationCycle, reply.publicationCycle),
    eq(replies.publicationAttempts, reply.publicationAttempts),
    eq(replies.stateRevision, reply.stateRevision),
    snapshot.lastErrorClass
      ? eq(replies.publicationLastErrorClass, snapshot.lastErrorClass)
      : undefined,
  )
}

async function casUncertainAttempt(
  run: Pick<Database, 'update'>,
  reply: Reply,
  snapshot: UncertainSendSnapshot,
  set: Record<string, unknown>,
): Promise<Reply | null> {
  const result = await run
    .update(replies)
    .set(set)
    .where(uncertainAttemptWhere(reply, snapshot))
    .returning()
  return result[0] ? replyFromRow(result[0]) : null
}

/** Outcomes an uncertain attempt row can still carry. */
const UNCERTAIN_ATTEMPT_OUTCOMES = ['sending', 'ambiguous'] as const

/**
 * D4 under lock: the Reply row (same order as every other publication write,
 * Reply before attempt), then the attempt row. The permit issuer holds FOR SHARE
 * on that attempt row until its permit commits, so once this returns no permit
 * can be admitted for the attempt without this transaction seeing it.
 * Null when the snapshot lost the compare-and-set.
 */
async function lockUncertainAttempt(
  tx: Tx,
  reply: Reply,
  snapshot: UncertainSendSnapshot,
): Promise<Readonly<{ startedAt: Date }> | null> {
  const locked = await tx
    .select({ id: replies.id })
    .from(replies)
    .where(uncertainAttemptWhere(reply, snapshot))
    .for('update')
    .limit(1)
  if (!locked[0]) return null
  const attempts = await tx
    .select({ createdAt: replyPublicationAttempts.createdAt })
    .from(replyPublicationAttempts)
    .where(
      and(
        eq(replyPublicationAttempts.replyId, reply.id),
        eq(replyPublicationAttempts.organizationId, reply.organizationId),
        eq(replyPublicationAttempts.publicationCycle, reply.publicationCycle),
        eq(replyPublicationAttempts.attemptNumber, reply.publicationAttempts),
        inArray(replyPublicationAttempts.outcome, [...UNCERTAIN_ATTEMPT_OUTCOMES]),
      ),
    )
    .for('update')
    .limit(1)
  if (!attempts[0]) {
    throw reviewError(
      'invalid_transition',
      'Reply publication attempt evidence is missing',
    )
  }
  return { startedAt: attempts[0].createdAt }
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

/** The cycle can no longer be claimed — its named manager lost current
 * authority, its Property is no longer active at its source epoch, or it holds
 * AI text whose binding went stale before any claim: move it to cancelled and
 * commit the durable policy cancellation fact when the row is still
 * claimable. Resolves null, the claim's own answer for a cycle it did not
 * take. */
async function cancelUnclaimablePublication(
  tx: Tx,
  reply: Reply,
  attempt: PublicationAttemptStart,
  at: Date,
): Promise<null> {
  const cancellation = cancelledPublication(reply)
  if (!cancellation) return null
  // Only the cycle this claim read as unclaimed: a row another worker has
  // since claimed is that worker's to settle.
  const cancelled = await guardedPublicationUpdate(
    tx,
    reply,
    'approved',
    ['authorized'],
    {
      ...cancellation,
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
    authorId: replyAuthor(cancelled),
    cause: 'policy',
    occurredAt: at,
  })
  await insertOutboxRow(tx, fact)
  return null
}

export const createAtomicReplyCommandStore = (
  db: Database,
  clock: () => Date,
  publicationActorAuthority: ReplyPublicationActorAuthority = missingPublicationActorAuthority,
): ReplyCommandStore => {
  /** Shared runner for the guarded-transition commands. */
  const transition = async (
    span: string,
    reply: Reply,
    command: ReplyCommand,
    updates: ConditionalReplyUpdate,
    event: DomainEvent | null,
    now?: Date,
  ): Promise<Reply | null> => {
    return trace(span, async () => {
      const occurredAt = now ?? clock()
      const saved = await db.transaction(async (tx) => {
        const row = await guardedReplyUpdate(tx, reply, command, updates, occurredAt)
        if (!row) return null
        if (event) await insertOutboxRow(tx, event)
        return row
      })
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
      return saved
    })
  }

  /**
   * Split the shared authorization-fence validation and evidence write from
   * command-specific lifecycle facts so approval and edit keep one invariant.
   */
  const authorizePublicationCycle = async (
    tx: Tx,
    input: Readonly<{
      reply: Reply
      command: Extract<ReplyCommand, 'approve' | 'retry_publication' | 'edit_published'>
      intent: PublicationAuthorizationFacts['publicationIntent']
      publicationCycle: number
      updates: ConditionalReplyUpdate
      occurredAt: Date
    }>,
  ): Promise<Reply | null> => {
    const { reply, command, intent, publicationCycle, updates, occurredAt } = input
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
    const row = await guardedReplyUpdate(
      tx,
      reply,
      command,
      {
        ...updates,
        publicationState: 'authorized',
        publicationCycle,
        publicationAttempts: 0,
        publicationLastErrorClass: null,
        reconcileDueAt: new Date(
          occurredAt.getTime() + PUBLICATION_RECOVERY_RECONCILE_DELAY_MS,
        ),
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
    return row
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
      transition('reply.commandStore.submitReply', reply, 'submit', updates, event, now),
    rejectReply: (reply, updates, event, now) =>
      transition('reply.commandStore.rejectReply', reply, 'reject', updates, event, now),
    // BQC-3.8: publish also persists publication_state='published' and clears
    // the reconcile schedule — provider confirmation is authoritative.
    markPublished: (reply, updates, event, now) =>
      transition(
        'reply.commandStore.markPublished',
        reply,
        'confirm_published',
        { ...updates, publicationState: 'published', reconcileDueAt: null },
        event,
        now,
      ),

    // BQC-3.8: authorize = approve/retry re-authorization (new publication
    // cycle): guarded status update + authorized state + cycle reset + the
    // approved fact when one is supplied — one transaction. The write also
    // names the state revision of `reply`: a Reply rejected, rewritten and
    // submitted again since it was read is in the same status and cycle and
    // matches no row, so the text authorized is the text the caller read.
    //
    // One write, two commands, told apart by the approved fact. An approval
    // carries it, starts from `pending_approval`, and records the manager the
    // intent names as approver. A retry carries none, starts from a settled
    // failure, and keeps the approval the reply already has. A retry-shaped
    // call can therefore not approve a pending reply, and neither shape can
    // re-authorize a reply whose last attempt is of unknown outcome.
    markPublicationAuthorized: (reply, updates, facts, now) => {
      const command = facts.lifecycleEvent ? 'approve' : 'retry_publication'
      if (!replyCommandMayStart(command, reply) || !nextStateOrNull(reply, 'authorize')) {
        return Promise.resolve(null)
      }
      const publicationCycle = assertPublicationIntentMatchesCycle(reply, facts)
      const occurredAt = now ?? clock()
      return trace('reply.commandStore.markPublicationAuthorized', async () => {
        const saved = await db.transaction(async (tx) => {
          const row = await authorizePublicationCycle(tx, {
            reply,
            command,
            intent: facts.publicationIntent,
            publicationCycle,
            updates:
              command === 'approve'
                ? {
                    ...updates,
                    status: 'approved',
                    approvedBy: facts.publicationIntent.userId,
                    approvedAt: updates.approvedAt ?? occurredAt,
                  }
                : { status: 'approved' },
            occurredAt,
          })
          if (!row) return null
          if (facts.lifecycleEvent) await insertOutboxRow(tx, facts.lifecycleEvent)
          await insertOutboxRow(tx, facts.publicationIntent)
          return row
        })
        return saved
      })
    },

    // BQC-3.8/RPL-01: claim. The normal claim records no fact. If the named
    // manager has lost current authority, or the Property is no longer active
    // at the cycle's source epoch (an Archive or Restore since approval), the
    // same transaction instead moves the cycle to draft/cancelled and records
    // publication_cancelled(policy), so a consumed job never strands an
    // authorized Reply and nothing reaches the provider authorizer to refuse.
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
        const claimed = await db.transaction(async (tx) => {
          const property = await lockPublicationProperty(
            tx,
            reply.organizationId,
            attempt.propertyId,
          )
          const scope = await lockCurrentReplyTruthScope(tx, {
            organizationId: reply.organizationId,
            reviewId: reply.reviewId,
            propertyId: attempt.propertyId,
          })
          if (!scope) return null
          // The last gate for AI text (domain/reply-ai-text.ts): it is claimed
          // while its binding is current, or once it was claimed before. Text
          // that never was and is stale now is not sent, by this cycle or by a
          // retry of it: the cycle is cancelled and the Reply returns to
          // draft, where a manager makes the text their own.
          if (!(await aiTextMayBeClaimed(tx, reply))) {
            return cancelUnclaimablePublication(tx, reply, attempt, at)
          }
          const authorization = await readCurrentPublicationAuthorization(
            tx,
            reply,
            attempt,
            scope,
          )
          if (!authorization) return null
          if (!propertyAdmitsCycle(property, authorization)) {
            return cancelUnclaimablePublication(tx, reply, attempt, at)
          }
          const actorAllowed = await publicationActorAuthority(tx, {
            organizationId: authorization.organizationId,
            propertyId: authorization.propertyId,
            userId: authorization.authorizedByUserId,
            at,
          })
          if (!actorAllowed) return cancelUnclaimablePublication(tx, reply, attempt, at)
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

          const head = scope.head
          if (
            (head?.observationRevision ?? 0) !== authorization.baseObservationRevision
          ) {
            return null
          }
          const claimed = await guardedPublicationUpdate(
            tx,
            reply,
            'approved',
            ['authorized'],
            {
              publicationState: target,
              publicationAttempts: sql`${replies.publicationAttempts} + 1`,
              reconcileDueAt: new Date(
                at.getTime() + PUBLICATION_RECOVERY_RECONCILE_DELAY_MS,
              ),
              updatedAt: at,
            },
          )
          if (!claimed) return null
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

    deferPendingPublicationObservation: async (reply, now) => {
      if (reply.publicationState !== 'pending_observation') return null
      return trace('reply.commandStore.deferPendingPublicationObservation', async () => {
        const at = now ?? clock()
        return guardedPublicationUpdate(db, reply, 'approved', ['pending_observation'], {
          reconcileDueAt: new Date(
            at.getTime() + PROVIDER_OBSERVATION_RECONCILE_DELAY_MS,
          ),
          updatedAt: at,
        })
      })
    },

    markPublicationTerminal: (reply, errorClass, event, now) =>
      publicationTransition(
        'reply.commandStore.markPublicationTerminal',
        reply,
        'fail_terminal',
        ['requested', 'authorized', 'sending', 'ambiguous'],
        (target, at) => ({
          status: 'publish_failed',
          publicationState: target,
          publicationLastErrorClass: errorClass,
          reconcileDueAt: null,
          updatedAt: at,
        }),
        event,
        now,
        async (tx, saved, at) => {
          if (saved.publicationAttempts < 1) return
          await updateCurrentAttempt(tx, saved, {
            outcome:
              errorClass === 'terminal_rejection'
                ? 'terminal_rejection'
                : errorClass === 'retryable'
                  ? 'retryable_failure'
                  : 'ambiguous',
            updatedAt: at,
          })
        },
      ),

    markPublicationAmbiguous: (reply, event, now, dueAt) =>
      publicationTransition(
        'reply.commandStore.markPublicationAmbiguous',
        reply,
        'fail_ambiguous',
        ['sending', 'pending_observation'],
        (target, at) => {
          if (dueAt) assertDueAfter(dueAt, at)
          return {
            status: 'publish_failed',
            publicationState: target,
            publicationLastErrorClass: 'ambiguous',
            reconcileDueAt:
              dueAt ?? new Date(at.getTime() + AMBIGUOUS_RECONCILE_DELAY_MS),
            updatedAt: at,
          }
        },
        event,
        now,
        (tx, saved, at) =>
          updateCurrentAttempt(tx, saved, {
            outcome: 'ambiguous',
            updatedAt: at,
          }),
      ),

    // D3: an uncertain send waits inside its propagation grace. Only the due
    // time moves: no fact, no attempt change, and `sending` stays unclaimable.
    deferUncertainSend: async (reply, dueAt, now) => {
      const snapshot = uncertainSnapshotFor(reply, DEFERRABLE_SEND)
      if (!snapshot) return null
      assertDueAfter(dueAt, now)
      return trace('reply.commandStore.deferUncertainSend', () =>
        casUncertainAttempt(db, reply, snapshot, {
          reconcileDueAt: dueAt,
          updatedAt: now,
        }),
      )
    },

    // D3: ambiguity moves to its next ladder read. A failed or unreadable read
    // lands here too, so it can never end automatic checks on its own.
    rescheduleAmbiguousReconciliation: async (reply, dueAt, now) => {
      const snapshot = uncertainSnapshotFor(reply, LADDER_AMBIGUITY)
      if (!snapshot) return null
      assertDueAfter(dueAt, now)
      return trace('reply.commandStore.rescheduleAmbiguousReconciliation', () =>
        casUncertainAttempt(db, reply, snapshot, {
          reconcileDueAt: dueAt,
          updatedAt: now,
        }),
      )
    },

    // D4: positive evidence that this attempt never reached Google makes it an
    // ordinary not-published failure a manager may retry (a new cycle through
    // the normal authorization). The fact records a failure the manager has
    // not been told about yet; an ambiguous row already carried one.
    //
    // The caller's evidence was read before this transaction, so a permit
    // admitted since then would be invisible to it. The evidence is asked
    // again here, after the attempt row is locked; a permit or a restore found
    // then leaves the attempt untouched and returns null like a lost CAS.
    settleNeverDispatchedAttempt: async (reply, event, now) => {
      const snapshot = uncertainSnapshotFor(reply, NEVER_DISPATCHED_SETTLEABLE)
      if (!snapshot) return null
      if (reply.publicationCycle < 1 || reply.publicationAttempts < 1) {
        throw reviewError(
          'invalid_transition',
          'Reply publication attempt evidence is missing',
        )
      }
      return trace('reply.commandStore.settleNeverDispatchedAttempt', () =>
        db.transaction(async (tx) => {
          const attempt = await lockUncertainAttempt(tx, reply, snapshot)
          if (!attempt) return null
          const mayHaveDispatched = await attemptMayHaveDispatched(tx, {
            organizationId: reply.organizationId,
            replyId: reply.id,
            publicationCycle: reply.publicationCycle,
            attemptNumber: reply.publicationAttempts,
            attemptStartedAt: attempt.startedAt,
          })
          if (mayHaveDispatched) return null
          const saved = await casUncertainAttempt(tx, reply, snapshot, {
            status: 'publish_failed',
            publicationState: 'terminal',
            publicationLastErrorClass: 'retryable',
            reconcileDueAt: null,
            updatedAt: now,
          })
          if (!saved) return null
          await updateCurrentAttempt(
            tx,
            saved,
            { outcome: 'retryable_failure', updatedAt: now },
            UNCERTAIN_ATTEMPT_OUTCOMES,
          )
          if (event && snapshot.status !== 'publish_failed') {
            await insertOutboxRow(tx, event)
          }
          return saved
        }),
      )
    },

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
              reconcileDueAt: new Date(
                occurredAt.getTime() + PUBLICATION_RECOVERY_RECONCILE_DELAY_MS,
              ),
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
      if (!replyCommandMayStart('edit_published', reply)) return Promise.resolve(null)
      const publicationCycle = assertPublicationIntentMatchesCycle(reply, command)
      const occurredAt = command.now ?? clock()
      return trace('reply.commandStore.editPublishedReply', async () => {
        const saved = await db.transaction(async (tx) => {
          const row = await authorizePublicationCycle(tx, {
            reply,
            command: 'edit_published',
            intent: command.publicationIntent,
            publicationCycle,
            updates: { text: command.text, status: 'approved' },
            occurredAt,
          })
          if (!row) return null
          await insertOutboxRow(tx, command.lifecycleEvent)
          await insertOutboxRow(tx, command.publicationIntent)
          return row
        })
        return saved
      })
    },

    cancelPublications: async (commands) => {
      return trace('reply.commandStore.cancelPublications', async () => {
        if (commands.length === 0) return 0
        const cancelled = await db.transaction(async (tx) => {
          let count = 0
          for (const { reply, event, now } of commands) {
            // Rows whose state moved on (published/failed/cancelled/purged)
            // are skipped without a fact — the batch still commits. So is a
            // row a worker claimed after the caller read it as undispatched:
            // the guard compares the exact state and attempt count.
            const cancellation = cancelledPublication(reply)
            if (!cancellation) continue
            const occurredAt = now ?? clock()
            const row = await guardedPublicationUpdate(
              tx,
              reply,
              reply.status,
              ['requested', 'authorized', 'sending', 'pending_observation'],
              { ...cancellation, updatedAt: occurredAt },
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
            count++
          }
          return count
        })
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
