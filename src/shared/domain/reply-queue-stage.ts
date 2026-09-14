/**
 * D8: the one rule that decides which Inbox reply queue a review's effective
 * reply belongs to. It lives in shared/domain because two runtimes must agree
 * on it without importing each other: the Review repository's SQL stage CASE
 * (`reply.repository.ts` findReviewIdsByReplyStage, which feeds queue lists and
 * counts) and the browser's optimistic queue matcher
 * (`components/inbox/inbox-queues.ts` itemMatchesQueue). The SQL CASE is built
 * from the constants below, and `reply.repository.test.ts` enumerates every
 * status × publication state × due time against both.
 *
 * Statuses are plain strings so the Review and Inbox copies of the reply status
 * union both fit without this module importing either context.
 */

export type ReplyQueueStage = 'needs_reply' | 'awaiting' | 'waiting'

export type ReplyQueueStageInput = Readonly<{
  status: string
  publicationState: string | null
  /**
   * A serialized browser cache snapshot may carry the due time as a string; a
   * snapshot without the field is not evidence that automatic checks continue.
   */
  reconcileDueAt?: Date | string | null
}>

/** Every persisted reply status (`replyStatusEnum`), for exhaustive tests. */
export const REPLY_QUEUE_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'published',
  'rejected',
  'publish_failed',
] as const

/** Every persisted publication state (`replies_publication_state_check`). */
export const REPLY_QUEUE_PUBLICATION_STATES = [
  'requested',
  'authorized',
  'sending',
  'pending_observation',
  'published',
  'terminal',
  'ambiguous',
  'cancelled',
] as const

export const AWAITING_REPLY_STATUSES: readonly string[] = ['pending_approval']

export const WAITING_REPLY_STATUSES: readonly string[] = ['approved', 'published']

/**
 * An uncertain publish (Google may already have the reply) that the automatic
 * read ladder still owns: reconcile_due_at stays set until the ladder ends
 * (`nextAmbiguousReconcileDueAt` returns null → terminal ambiguity). Nobody needs
 * to act while it is set, so it waits with the other in-flight replies; once it
 * clears, the reply needs a person and falls back to Needs reply.
 */
export const UNCERTAIN_REPLY_STILL_CHECKED = {
  status: 'publish_failed',
  publicationState: 'ambiguous',
} as const

export function isUncertainReplyStillChecked(reply: ReplyQueueStageInput): boolean {
  return (
    reply.status === UNCERTAIN_REPLY_STILL_CHECKED.status &&
    reply.publicationState === UNCERTAIN_REPLY_STILL_CHECKED.publicationState &&
    reply.reconcileDueAt !== null &&
    reply.reconcileDueAt !== undefined
  )
}

export function replyQueueStage(reply: ReplyQueueStageInput): ReplyQueueStage {
  if (AWAITING_REPLY_STATUSES.includes(reply.status)) return 'awaiting'
  if (WAITING_REPLY_STATUSES.includes(reply.status)) return 'waiting'
  if (isUncertainReplyStillChecked(reply)) return 'waiting'
  return 'needs_reply'
}
