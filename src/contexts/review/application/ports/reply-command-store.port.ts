// Reply command store — atomic reply/review state mutation + outbox record (BQC-3.3).
//
// Callers must not know Drizzle transaction types or outbox tables.
// The production implementation commits the state write and the outbox_events
// row in one PostgreSQL transaction, then emits on the in-process bus after
// commit (expand-phase dual path until durable switch).
//
// BQC-3.8: the publication state machine (domain/reply-publication-workflow.ts)
// is persisted through this store. Every external-interaction transition is a
// guarded write (status + publication_state), so a lost TOCTOU race
// (cancellation, a racing claim, a purge) records no fact and returns null.

import type { OrganizationId, ReviewId } from '#/shared/domain/ids'
import type { Reply } from '../../domain/types'
import type { PublicationFailureClass } from '../../domain/reply-publication-workflow'
import type {
  ReviewExpired,
  ReviewReplyApproved,
  ReviewReplyPublicationCancelled,
  ReviewReplyPublished,
  ReviewReplyPublishFailed,
  ReviewReplyRejected,
  ReviewReplySubmitted,
  ReviewReplyUpdated,
} from '../../domain/events'
import type { ConditionalReplyUpdate } from './reply.repository'

/** The edit-and-republish write: new text + re-authorization in one command. */
export type EditPublishedReplyCommand = Readonly<{
  text: string
  event: ReviewReplyUpdated
  now?: Date
}>

/** Mirror command for the GBP sync path: upsert or delete the google_sync reply. */
export type MirrorSyncedReplyCommand = Readonly<{
  /** google_sync reply to upsert; null → delete the mirror for this review. */
  reply: Omit<Reply, 'createdAt' | 'updatedAt'> | null
  reviewId: ReviewId
  organizationId: OrganizationId
  /**
   * review.reply.published{source:'import'} fact for newly-discovered Google
   * replies. Null → no fact (existing-mirror refresh and the delete path
   * never emit one).
   */
  event: ReviewReplyPublished | null
  now?: Date
}>

/**
 * BQC-3.8: one cancellation per reply — the guarded state write and the
 * review.reply.publication_cancelled fact commit in the batch transaction.
 * Rows whose publication state moved on meanwhile (published / failed /
 * already cancelled / purged) are skipped without a fact.
 */
export type CancelPublicationCommand = Readonly<{
  reply: Reply
  event: ReviewReplyPublicationCancelled
  now?: Date
}>

export type ReplyCommandStore = Readonly<{
  /**
   * Guarded transition + review.reply.submitted fact, one transaction.
   * The update applies only while the reply's current status still equals
   * `reply.status` (TOCTOU guard, same semantics as
   * ReplyRepository.conditionalUpdate). Returns null on a lost race — the
   * caller throws invalid_transition exactly as with conditionalUpdate today.
   */
  submitReply(
    reply: Reply,
    updates: ConditionalReplyUpdate,
    event: ReviewReplySubmitted,
    now?: Date,
  ): Promise<Reply | null>
  /**
   * BQC-3.8: the approve/retry authorization write. Guarded status update +
   * publication_state='authorized' with attempts/last-error/reconcile-due
   * reset (a NEW publication cycle) + the review.reply.approved fact — one
   * transaction. `event` is null on the retryPublish path (re-authorization
   * emits no new fact, exactly as before).
   */
  markPublicationAuthorized(
    reply: Reply,
    updates: ConditionalReplyUpdate,
    event: ReviewReplyApproved | null,
    now?: Date,
  ): Promise<Reply | null>
  /**
   * BQC-3.8: publish-job claim — status='approved' AND publication_state IN
   * ('authorized','sending') → 'sending', attempts+1. 'sending' re-claim is
   * the SAME BullMQ job retrying after an ambiguous attempt (jobId
   * idempotency serializes attempts — no second worker can hold the claim).
   * No fact. Returns null when the guard misses (cancelled meanwhile, or the
   * row is no longer in a claimable state).
   */
  markPublicationSending(reply: Reply, now?: Date): Promise<Reply | null>
  /**
   * BQC-3.8: classified terminal rejection — status → publish_failed +
   * publication_state='terminal' + last_error_class + the publish_failed
   * fact, one transaction. `event` is null only when the parent review row
   * is missing (impossible under the replies→reviews FK): the update then
   * commits fact-less, mirroring the pre-BQC-3.3 tolerate-and-log path.
   */
  markPublicationTerminal(
    reply: Reply,
    errorClass: PublicationFailureClass,
    event: ReviewReplyPublishFailed | null,
    now?: Date,
  ): Promise<Reply | null>
  /**
   * BQC-3.8: classified ambiguous outcome on the final attempt — status →
   * publish_failed + publication_state='ambiguous' + last_error_class=
   * 'ambiguous' + reconcile_due_at = now + AMBIGUOUS_RECONCILE_DELAY_MS +
   * the publish_failed fact, one transaction. The persisted class and due
   * date are what the reconcile sweep finds the row by.
   */
  markPublicationAmbiguous(
    reply: Reply,
    event: ReviewReplyPublishFailed | null,
    now?: Date,
  ): Promise<Reply | null>
  /**
   * BQC-3.8: classified retryable failure — publication_state 'sending' →
   * 'authorized' with last_error_class and attempts preserved, so the next
   * BullMQ attempt (or a quarantine redrive) can claim the row again. No
   * fact. Returns null when the guard misses.
   */
  markPublicationRetryQueued(reply: Reply, now?: Date): Promise<Reply | null>
  /**
   * Edit-and-republish: guarded status='published' → 'approved' with the new
   * text and a fresh publication cycle (publication_state='authorized',
   * attempts/error/reconcile-due reset) + the review.reply.updated fact, one
   * transaction. Returns null when the reply is no longer published (race
   * with a purge/cancellation or a concurrent edit) — no fact, no mutation.
   */
  editPublishedReply(
    reply: Reply,
    command: EditPublishedReplyCommand,
  ): Promise<Reply | null>
  /**
   * BQC-3.8: disconnect/policy cancellation — per command, guarded
   * publication_state IN ('requested','authorized','sending') → 'cancelled'
   * + status → 'draft' + the publication_cancelled fact, ALL in one
   * transaction for the batch. Returns the number of cancelled rows; rows
   * whose state moved on (published/failed/cancelled/purged) are skipped.
   */
  cancelPublications(commands: ReadonlyArray<CancelPublicationCommand>): Promise<number>
  /**
   * Guarded transition → rejected + review.reply.rejected fact, one transaction. */
  rejectReply(
    reply: Reply,
    updates: ConditionalReplyUpdate,
    event: ReviewReplyRejected,
    now?: Date,
  ): Promise<Reply | null>
  /**
   * Guarded transition approved → published + published fact, one
   * transaction. BQC-3.8: also persists publication_state='published' and
   * clears reconcile_due_at — provider confirmation is authoritative from
   * any publication state (job ack from 'sending', reconciliation heal from
   * 'ambiguous'/'terminal', legacy pre-0015 rows from NULL).
   */
  markPublished(
    reply: Reply,
    updates: ConditionalReplyUpdate,
    event: ReviewReplyPublished,
    now?: Date,
  ): Promise<Reply | null>
  /**
   * GBP mirror write: upsert the google_sync reply (with the published fact
   * when one is supplied) or delete the mirror — in one transaction.
   * Returns the upserted reply, or null for the delete path.
   */
  mirrorSyncedReply(command: MirrorSyncedReplyCommand): Promise<Reply | null>
  /**
   * Retention purge: delete the review and record review.expired in one
   * transaction (replaces the job's pre-BQC-3.3 emit-then-delete flow).
   * The organization scope comes from the event.
   */
  purgeExpiredReview(reviewId: ReviewId, event: ReviewExpired): Promise<void>
}>
