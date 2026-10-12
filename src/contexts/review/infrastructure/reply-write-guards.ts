// Compare-and-set guards for reply writes.
//
// A guarded write names the reply it decided on: the row must still have the
// status and the publication state the caller read, in the same publication
// cycle. The caller's snapshot is checked first against what the command may
// start from (domain/reply-command-preconditions.ts), so a write cannot be
// aimed at a reply that belongs to another command, and a reply that moved
// between the read and the write matches no row. Either way the write returns
// null, records no fact, and the caller reports `invalid_transition`.

import { and, eq, isNull, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { replies } from '#/shared/db/schema/review.schema'
import type { Reply } from '../domain/types'
import {
  replyCommandMayStart,
  type ReplyCommand,
} from '../domain/reply-command-preconditions'
import type { PersistedPublicationState } from '../domain/reply-publication-workflow'
import type { ConditionalReplyUpdate } from '../application/ports/reply.repository'
import { replyFromRow } from './mappers/reply.mapper'
import { buildReplySetClause } from './reply-set-clause'

type ReplyWriter = Pick<Database, 'update'>

/** The row is still the reply the caller read: same status, same publication
 * state (NULL included), same cycle. */
function replySnapshotWhere(reply: Reply): SQL | undefined {
  return and(
    eq(replies.id, reply.id),
    eq(replies.organizationId, reply.organizationId),
    eq(replies.status, reply.status),
    reply.publicationState === null
      ? isNull(replies.publicationState)
      : eq(replies.publicationState, reply.publicationState),
    eq(replies.publicationCycle, reply.publicationCycle),
  )
}

/**
 * Guarded write for one reply command. Null when `command` may not start from
 * the snapshot, or when the row is no longer that snapshot.
 */
export async function guardedReplyUpdate(
  run: ReplyWriter,
  reply: Reply,
  command: ReplyCommand,
  updates: ConditionalReplyUpdate,
  occurredAt: Date,
): Promise<Reply | null> {
  if (!replyCommandMayStart(command, reply)) return null
  const result = await run
    .update(replies)
    .set(buildReplySetClause(updates, occurredAt))
    .where(replySnapshotWhere(reply))
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
