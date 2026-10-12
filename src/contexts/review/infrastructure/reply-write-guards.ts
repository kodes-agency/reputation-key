// Compare-and-set guards for reply writes.
//
// A guarded write names the reply it decided on: the row must still have the
// status and the publication state the caller read, in the same publication
// cycle. The caller's snapshot is checked first against what the command may
// start from (domain/reply-command-preconditions.ts), so a write cannot be
// aimed at a reply that belongs to another command, and a reply that moved
// between the read and the write matches no row. Either way the write returns
// null, records no fact, and the caller reports `invalid_transition`.
//
// The same write carries what its command means for AI-assisted text
// (domain/reply-ai-text.ts): a command that moves unedited AI text toward
// Google is refused while the AI draft binding is stale, and a command by
// which a manager writes the text records the reply as human-authored. The
// worker's claim, the last gate before a request leaves, asks here too
// (`aiTextMayBeClaimed`).
//
// Not every writer of a reply comes through here. The AI draft purge
// (src/shared/db/ai/ai-draft-purge.ts) runs in other contexts' transactions
// and empties a reply in place: a draft whose cycle was cancelled is the same
// draft afterwards, in the same publication state and cycle, with no text. So
// a command that puts the text forward compares the state revision as well,
// which the database advances whenever text, status or authorship changes.

import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { replies, replyPublicationAttempts } from '#/shared/db/schema/review.schema'
import type { Tx } from '#/shared/outbox/commit'
import type { Reply } from '../domain/types'
import {
  replyCommandMayStart,
  type ReplyCommand,
} from '../domain/reply-command-preconditions'
import { aiTextRuleOf } from '../domain/reply-ai-text'
import { reviewError } from '../domain/errors'
import { googleReplyTextDigest } from '../domain/google-reply-observation'
import type { PersistedPublicationState } from '../domain/reply-publication-workflow'
import type { ConditionalReplyUpdate } from '../application/ports/reply.repository'
import { aiDraftInputsAreCurrent, assertCurrentAiDraftBinding } from './ai-draft-binding'
import { replyFromRow } from './mappers/reply.mapper'
import { buildReplySetClause } from './reply-set-clause'

type ReplyWriter = Pick<Database, 'update'>

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
 * forward, the same state revision too; for a retry, the same failure. */
function replySnapshotWhere(reply: Reply, command: ReplyCommand): SQL | undefined {
  return and(
    eq(replies.id, reply.id),
    eq(replies.organizationId, reply.organizationId),
    eq(replies.status, reply.status),
    reply.publicationState === null
      ? isNull(replies.publicationState)
      : eq(replies.publicationState, reply.publicationState),
    eq(replies.publicationCycle, reply.publicationCycle),
    PUTS_TEXT_FORWARD.has(command)
      ? eq(replies.stateRevision, reply.stateRevision)
      : undefined,
    command === 'retry_publication' ? sameFailureWhere(reply) : undefined,
  )
}

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
export async function aiTextMayBeClaimed(tx: Tx, reply: Reply): Promise<boolean> {
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
export async function guardedReplyUpdate(
  tx: Tx,
  reply: Reply,
  command: ReplyCommand,
  updates: ConditionalReplyUpdate,
  occurredAt: Date,
): Promise<Reply | null> {
  if (!replyCommandMayStart(command, reply)) return null
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
    .where(replySnapshotWhere(reply, command))
    .returning()
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
export async function guardedPublicationUpdate(
  run: ReplyWriter,
  reply: Reply,
  expectedStatus: Reply['status'],
  allowedStates: ReadonlyArray<PersistedPublicationState>,
  set: Record<string, unknown>,
): Promise<Reply | null> {
  const state = reply.publicationState
  if (state === null || !allowedStates.includes(state)) return null
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
export async function updateCurrentAttempt(
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
