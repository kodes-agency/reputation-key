import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { OrganizationId, ReviewId } from '#/shared/domain/ids'
import {
  carryDraftMeasurement,
  submitDraftMeasurement,
  submittedMeasurementIdentity,
} from '#/shared/db/ai/draft-measurement-lineage'
import {
  replies,
  replyPublicationAttempts,
  reviews,
} from '#/shared/db/schema/review.schema'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import {
  aiTextRuleOf,
  googleReplyTextDigest,
  hasPublicationRecord,
  replyCommandMayStart,
  reviewError,
  UNCERTAIN_ATTEMPT_OUTCOMES,
  type Reply,
  type PersistedPublicationState,
  type ReplyCommand,
  type ReplyCommandStore,
  type ReplyWriter,
  type ConditionalReplyUpdate,
  type UncertainSendSnapshot,
} from '#/contexts/review/application/public-api'

/**
 * The commands whose write puts the reply's text forward: submit hands it to
 * an approver, and an approval, a retry and an edit authorize sending it to
 * Google. Each acts on whatever text the row holds at that moment (the
 * authorization digests it), so these writes also name the state revision the
 * caller read. A reply that was rejected, rewritten and submitted again is in
 * the same status and the same cycle as before, and it is a different reply.
 * So is a draft the AI draft purge emptied since: without the revision, a
 * submit that read the AI text would hand an approver a reply with no text.
 * Its revision moved, because the database advances it on every change of
 * text, status or authorship.
 */
const PUTS_TEXT_FORWARD: ReadonlySet<ReplyCommand> = new Set([
  'submit',
  'approve',
  'retry_publication',
  'edit_published',
])

/** A retry's precondition reads how the last cycle failed: a failure of
 * unknown outcome is never sent again. The row must still say what the caller
 * read, so a snapshot that calls an uncertain reply settled matches no row. */
function sameFailureWhere(reply: Reply): SQL {
  return reply.publicationLastErrorClass === null
    ? isNull(replies.publicationLastErrorClass)
    : eq(replies.publicationLastErrorClass, reply.publicationLastErrorClass)
}

/** The row is still the reply the caller read: same status, same publication
 * state (NULL included), same cycle; for a command that puts its text
 * forward or saves a draft, the same state revision too; for a retry, the same failure. */
function replySnapshotWhere(
  reply: Reply,
  command: ReplyCommand,
  fenceStateRevision = false,
): SQL | undefined {
  return and(
    eq(replies.id, reply.id),
    eq(replies.organizationId, reply.organizationId),
    eq(replies.status, reply.status),
    reply.publicationState === null
      ? isNull(replies.publicationState)
      : eq(replies.publicationState, reply.publicationState),
    eq(replies.publicationCycle, reply.publicationCycle),
    PUTS_TEXT_FORWARD.has(command) || fenceStateRevision
      ? eq(replies.stateRevision, reply.stateRevision)
      : undefined,
    command === 'retry_publication' ? sameFailureWhere(reply) : undefined,
  )
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

/** Review's row mapping, SET-clause and serialization helpers, which the writer applies to every Reply write. */
export type ReplyWriterRows = Readonly<{
  replyFromRow: (row: typeof replies.$inferSelect) => Reply
  replyToRow: (
    reply: Omit<Reply, 'createdAt' | 'updatedAt'>,
  ) => typeof replies.$inferInsert
  buildReplySetClause: (
    updates: ConditionalReplyUpdate,
    updatedAt: Date,
  ) => Record<string, unknown>
  lockReplyTruthScope: (
    tx: Tx,
    organizationId: OrganizationId,
    reviewId: ReviewId,
  ) => Promise<void>
  /** Locks the reply row; 'stale' means the AI draft is no longer the one reviewed. */
  assertCurrentAiDraftBinding: (
    tx: Tx,
    input: Readonly<{ organizationId: string; replyId: string }>,
  ) => Promise<'current' | 'not_ai' | 'stale'>
  aiDraftInputsAreCurrent: (
    tx: Tx,
    input: Readonly<{ organizationId: string; replyId: string }>,
  ) => Promise<boolean>
}>

export type ReplyWriterDeps = Readonly<{
  db: Database
  clock: () => Date
  rows: ReplyWriterRows
}>

/** Builds the writer of Reply rows. Review supplies its row mapping and serialization helpers as `rows`. */
export function createReplyWriter({ db, clock, rows }: ReplyWriterDeps): ReplyWriter {
  const {
    replyFromRow,
    replyToRow,
    buildReplySetClause,
    lockReplyTruthScope,
    assertCurrentAiDraftBinding,
    aiDraftInputsAreCurrent,
  } = rows

  /**
   * Whether unedited AI text may move toward Google now: true for a reply a
   * human authored, and for an AI-assisted one whose binding is current. Locks
   * the reply row, so the answer holds for the write that follows it in `tx`.
   */
  async function aiTextMayAdvance(tx: Tx, reply: Reply): Promise<boolean> {
    if (!reply.aiGenerated) return true
    const binding = await assertCurrentAiDraftBinding(tx, {
      organizationId: reply.organizationId,
      replyId: reply.id,
    })
    return binding !== 'stale'
  }

  /**
   * Whether a worker may claim the reply's text for sending now. The claim is
   * the last gate for unedited AI text: it needs a current binding until the
   * text has been claimed once. An attempt row is written only by a claim that
   * passed this gate, and it carries the digest of the text it was for. So an
   * attempt for the text the reply holds now is the evidence that these words
   * went through while they were current, and a later attempt for them, in the
   * same cycle or in the cycle of a retry, does not wait on a window that has
   * closed since. An attempt for other text proves nothing about this one.
   *
   * The evidence excuses the window and nothing else. When something the text
   * was generated from has changed since (AI switched off, a consent or profile
   * change, a guest edit), the AI draft purge withdraws every such reply it can
   * still reach, and it leaves a failed one alone only because its cycle ran to
   * its end. A retry of that reply must not send what the purge would have
   * withdrawn, so the claim refuses it, claimed before or not.
   */
  async function aiTextMayBeClaimed(tx: Tx, reply: Reply): Promise<boolean> {
    if (await aiTextMayAdvance(tx, reply)) return true
    const onlyItsWindowPassed = await aiDraftInputsAreCurrent(tx, {
      organizationId: reply.organizationId,
      replyId: reply.id,
    })
    if (!onlyItsWindowPassed) return false
    const claimedBefore = await tx
      .select({ id: replyPublicationAttempts.id })
      .from(replyPublicationAttempts)
      .where(
        and(
          eq(replyPublicationAttempts.organizationId, reply.organizationId),
          eq(replyPublicationAttempts.replyId, reply.id),
          eq(
            replyPublicationAttempts.expectedReplyDigest,
            googleReplyTextDigest(reply.text),
          ),
        ),
      )
      .limit(1)
    return claimedBefore[0] !== undefined
  }

  /**
   * Guarded write for one reply command. Null when `command` may not start from
   * the snapshot, when it moves stale AI text toward Google, or when the row is
   * no longer that snapshot.
   */
  async function guardedReplyUpdate(
    tx: Tx,
    reply: Reply,
    command: ReplyCommand,
    updates: ConditionalReplyUpdate,
    occurredAt: Date,
    fenceStateRevision = false,
  ): Promise<Reply | null> {
    if (!replyCommandMayStart(command, reply)) return null
    await lockReplyReview(tx, reply.organizationId, reply.reviewId)
    const aiText = aiTextRuleOf(command)
    if (aiText === 'needs_current_binding' && !(await aiTextMayAdvance(tx, reply))) {
      return null
    }
    const result = await tx
      .update(replies)
      .set(
        buildReplySetClause(
          aiText === 'ends_adoption' ? { ...updates, aiGenerated: false } : updates,
          occurredAt,
        ),
      )
      .where(replySnapshotWhere(reply, command, fenceStateRevision))
      .returning()
    if (result[0])
      await carryDraftMeasurement(tx, reply, result[0], updates.measurementGenerationId)
    return result[0] ? replyFromRow(result[0]) : null
  }

  /**
   * BQC-3.8: guarded publication write. The snapshot must be in one of
   * `allowedStates`, and the row must still be in that exact state, at that
   * attempt count: a claim moves `authorized` to `sending` and adds an attempt
   * without changing status, cycle or state revision, so a list of states would
   * let a writer that read `authorized` settle a row a worker has since claimed
   * and may be sending. Every publication writer therefore loses to any move it
   * did not see: a claim, an acknowledgement, a cancellation, a new cycle.
   */
  async function guardedPublicationUpdate(
    run: Tx,
    reply: Reply,
    expectedStatus: Reply['status'],
    allowedStates: ReadonlyArray<PersistedPublicationState>,
    set: Record<string, unknown>,
  ): Promise<Reply | null> {
    const state = reply.publicationState
    if (state === null || !allowedStates.includes(state)) return null
    await lockReplyReview(run, reply.organizationId, reply.reviewId)
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
          eq(replies.publicationState, state),
          eq(replies.publicationAttempts, reply.publicationAttempts),
        ),
      )
      .returning()
    return result[0] ? replyFromRow(result[0]) : null
  }

  /** Update the attempt row the Reply currently points at. Its absence means the
   * append-only publication evidence and the Reply have diverged. `fromOutcomes`
   * additionally refuses to rewrite an attempt that already reached any other
   * outcome (the transaction then rolls back with the Reply write). */
  async function updateCurrentAttempt(
    tx: Tx,
    reply: Reply,
    set: Record<string, unknown>,
    fromOutcomes?: ReadonlyArray<string>,
  ): Promise<void> {
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

  /** Submit and its scalar measurement share the same guarded transaction. */
  function submitMeasuredReply(
    ...[reply, updates, event, now, measurement]: Parameters<
      ReplyCommandStore['submitReply']
    >
  ): Promise<Reply | null> {
    return trace('reply.commandStore.submitReply', () =>
      db.transaction(async (tx) => {
        const row = await guardedReplyUpdate(tx, reply, 'submit', updates, now ?? clock())
        if (!row) return null
        await carryDraftMeasurement(
          tx,
          reply,
          row,
          submittedMeasurementIdentity(reply, measurement),
        )
        await submitDraftMeasurement(tx, reply, row, measurement)
        await insertOutboxRow(tx, event)
        return row
      }),
    )
  }

  /** The Review trigger advances its reply revision on writes, so take that row
   * before a Reply row. Use the observation advisory fence before either row. */
  async function withReplyReviewLock<T>(
    organizationId: Reply['organizationId'],
    reviewId: Reply['reviewId'],
    write: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    return db.transaction(async (tx) => {
      await lockReplyReview(tx, organizationId, reviewId)
      return write(tx)
    })
  }

  const drafts: ReplyWriter['drafts'] = {
    upsert: async (reply, now) => {
      return trace('reply.upsert', () =>
        withReplyReviewLock(reply.organizationId, reply.reviewId, async (tx) => {
          const row = replyToRow(reply)
          const updatedAt = now ?? clock()
          const result = await tx
            .insert(replies)
            .values(row)
            .onConflictDoUpdate({
              target: [replies.reviewId, replies.source, replies.organizationId],
              set: {
                text: row.text,
                replyLanguageTag: row.replyLanguageTag,
                templateId: row.templateId,
                templateVersion: row.templateVersion,
                templateLayer: row.templateLayer,
                templateRef: row.templateRef,
                templateRevision: row.templateRevision,
                templateWordingKey: row.templateWordingKey,
                voiceDigest: row.voiceDigest,
                voiceChoices: row.voiceChoices,
                status: row.status,
                approvedBy: row.approvedBy,
                rejectedBy: row.rejectedBy,
                rejectionReason: row.rejectionReason,
                aiGenerated: row.aiGenerated,
                stateRevision: row.stateRevision,
                submittedAt: row.submittedAt,
                approvedAt: row.approvedAt,
                publishedAt: row.publishedAt,
                updatedAt,
              },
            })
            .returning()

          if (!result[0]) {
            throw reviewError(
              'repo_upsert_failed',
              'Reply upsert failed — no row returned',
            )
          }
          return replyFromRow(result[0])
        }),
      )
    },

    createDraft: async (reply) => {
      return trace('reply.createDraft', () =>
        withReplyReviewLock(reply.organizationId, reply.reviewId, async (tx) => {
          if (reply.status !== 'draft' || hasPublicationRecord(reply)) {
            throw reviewError(
              'invalid_input',
              'A new reply starts as a draft with no publication',
            )
          }
          // Never ON CONFLICT DO UPDATE: a reply created since the caller looked
          // may already be submitted or confirmed, and an insert must not rewrite it.
          const result = await tx
            .insert(replies)
            .values(replyToRow(reply))
            .onConflictDoNothing({
              target: [replies.reviewId, replies.source, replies.organizationId],
            })
            .returning()
          return result[0] ? replyFromRow(result[0]) : null
        }),
      )
    },

    saveDraft: async (reply, content, now) => {
      return trace('reply.saveDraft', () =>
        withReplyReviewLock(reply.organizationId, reply.reviewId, async (tx) => {
          const updatedAt = now ?? clock()
          // The guard is the `save_draft` precondition as a compare-and-set: a
          // reply that is waiting for approval, being published or published
          // matches no row, whoever calls. A save never reads the AI draft
          // binding: a manager typing over AI text, however old, makes the reply
          // theirs, and the guard records it as human-authored
          // (domain/reply-ai-text.ts).
          const { fenceStateRevision, ...fields } = content
          return guardedReplyUpdate(
            tx,
            reply,
            'save_draft',
            { ...fields, status: 'draft', rejectedBy: null, rejectionReason: null },
            updatedAt,
            fenceStateRevision === true,
          )
        }),
      )
    },

    deleteDraft: async (reply) => {
      return trace('reply.deleteDraft', () =>
        withReplyReviewLock(reply.organizationId, reply.reviewId, async (tx) => {
          // A reply that was ever authorized keeps its authorization and attempt
          // rows (ON DELETE RESTRICT), so it is refused here, not left to fail on
          // the foreign key.
          if (!replyCommandMayStart('delete', reply)) return false
          const deleted = await tx
            .delete(replies)
            .where(
              and(
                eq(replies.id, reply.id),
                eq(replies.organizationId, reply.organizationId),
                // Still the reply that was read, and still without a publication.
                eq(replies.status, reply.status),
                eq(replies.stateRevision, reply.stateRevision),
                isNull(replies.publicationState),
                eq(replies.publicationCycle, 0),
              ),
            )
            .returning({ id: replies.id })
          return deleted.length > 0
        }),
      )
    },

    deleteByReviewIdAndSource: async (reviewId, source, organizationId) => {
      return trace('reply.deleteByReviewIdAndSource', () =>
        withReplyReviewLock(organizationId, reviewId, async (tx) => {
          await tx
            .delete(replies)
            .where(
              and(
                eq(replies.reviewId, reviewId),
                eq(replies.source, source),
                eq(replies.organizationId, organizationId),
              ),
            )
        }),
      )
    },
  }

  /** Publication and draft commands share the observation fence and row order. */
  async function lockReplyReview(
    tx: Tx,
    organizationId: Reply['organizationId'],
    reviewId: Reply['reviewId'],
  ): Promise<void> {
    await lockReplyTruthScope(tx, organizationId, reviewId)
    await tx
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.id, reviewId), eq(reviews.organizationId, organizationId)))
      .for('update')
  }

  async function casUncertainAttempt(
    run: Tx,
    reply: Reply,
    snapshot: UncertainSendSnapshot,
    set: Record<string, unknown>,
  ): Promise<Reply | null> {
    await lockReplyReview(run, reply.organizationId, reply.reviewId)
    const result = await run
      .update(replies)
      .set(set)
      .where(uncertainAttemptWhere(reply, snapshot))
      .returning()
    return result[0] ? replyFromRow(result[0]) : null
  }

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
    await lockReplyReview(tx, reply.organizationId, reply.reviewId)
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

  return {
    drafts,
    lockReplyReview,
    aiTextMayBeClaimed,
    guardedReplyUpdate,
    guardedPublicationUpdate,
    updateCurrentAttempt,
    submitMeasuredReply,
    casUncertainAttempt,
    lockUncertainAttempt,
  }
}
