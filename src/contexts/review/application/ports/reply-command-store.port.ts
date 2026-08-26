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

import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import type { Reply } from '../../domain/types'
import type { PublicationFailureClass } from '../../domain/reply-publication-workflow'
import type {
  ReviewExpired,
  ReviewReplyApproved,
  ReviewReplyPublicationCancelled,
  ReviewReplyPublicationRequested,
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
  lifecycleEvent: ReviewReplyUpdated
  publicationIntent: ReviewReplyPublicationRequested
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

/**
 * Facts committed with one approval/edit/retry authorization. The lifecycle
 * event remains the in-process notification/activity fact; publicationIntent
 * is always durable and is consumed by the worker recovery path.
 */
export type PublicationAuthorizationFacts = Readonly<{
  lifecycleEvent: ReviewReplyApproved | null
  publicationIntent: ReviewReplyPublicationRequested
}>

/** Immutable Review/provider-truth tuple that a manager authorized. */
export type PublicationAuthorizationFence = Readonly<{
  propertyId: PropertyId
  sourceEpoch: number
  materialReviewRevision: number
  /** Zero means no Google reply observation head existed at authorization. */
  baseObservationRevision: number
}>

/** Provider write response; it is evidence of an accepted request, not proof
 * that this exact reply is currently live on Google. */
export type ProviderOutcomePendingObservation = Readonly<{
  providerCorrelationId: string | null
  providerRespondedAt: Date
}>

/** Immutable scope/content fences captured when one provider attempt starts. */
export type PublicationAttemptStart = PublicationAuthorizationFence &
  Readonly<{
    providerOperationKey: string
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
   * reset (a NEW monotonic publication cycle) + the optional
   * review.reply.approved lifecycle fact + the required durable
   * review.reply.publication_requested intent — one transaction.
   */
  markPublicationAuthorized(
    reply: Reply,
    updates: ConditionalReplyUpdate,
    facts: PublicationAuthorizationFacts,
    now?: Date,
  ): Promise<Reply | null>
  /**
   * BQC-3.8: publish-job claim — status='approved' AND publication_state IN
   * ('authorized','sending') → 'sending', attempts+1. A 'sending' re-claim is
   * admitted only after this same BullMQ job has durably recorded targeted
   * provider readback proving the prior attempt's exact reply absent (jobId
   * idempotency serializes attempts — no second worker can hold the claim).
   * No fact. Returns null when the guard misses (cancelled meanwhile, or the
   * row is no longer in a claimable state).
   */
  markPublicationSending(
    reply: Reply,
    attempt: PublicationAttemptStart,
    now?: Date,
  ): Promise<Reply | null>
  /**
   * Persist a successful provider write response while keeping the local
   * Reply un-published. Only an exact, current provider observation may make
   * the later pending_observation → published transition.
   */
  markProviderOutcomePendingObservation(
    reply: Reply,
    outcome: ProviderOutcomePendingObservation,
    now?: Date,
  ): Promise<Reply | null>
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
   * Legacy retention command retained only for caller compatibility during
   * SAFE-03 containment. It always rejects before SQL/outbox until REV-01
   * separates expiring provider content from stable Review/Reply history.
   */
  purgeExpiredReview(reviewId: ReviewId, event: ReviewExpired): Promise<void>
}>
