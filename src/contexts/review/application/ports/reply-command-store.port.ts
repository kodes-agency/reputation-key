// Reply command store — atomic reply/review state mutation + outbox record (BQC-3.3).
//
// Callers must not know Drizzle transaction types or outbox tables.
// The production implementation commits the state write and the outbox_events
// row in one PostgreSQL transaction, then emits on the in-process bus after
// commit (expand-phase dual path until durable switch).

import type { OrganizationId, ReviewId } from '#/shared/domain/ids'
import type { Reply } from '../../domain/types'
import type {
  ReviewExpired,
  ReviewReplyApproved,
  ReviewReplyPublished,
  ReviewReplyPublishFailed,
  ReviewReplyRejected,
  ReviewReplySubmitted,
} from '../../domain/events'
import type { ConditionalReplyUpdate } from './reply.repository'

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
  /** Guarded transition + review.reply.approved fact, one transaction. */
  approveReply(
    reply: Reply,
    updates: ConditionalReplyUpdate,
    event: ReviewReplyApproved,
    now?: Date,
  ): Promise<Reply | null>
  /** Guarded transition + review.reply.rejected fact, one transaction. */
  rejectReply(
    reply: Reply,
    updates: ConditionalReplyUpdate,
    event: ReviewReplyRejected,
    now?: Date,
  ): Promise<Reply | null>
  /** Guarded transition approved → published + published fact, one transaction. */
  markPublished(
    reply: Reply,
    updates: ConditionalReplyUpdate,
    event: ReviewReplyPublished,
    now?: Date,
  ): Promise<Reply | null>
  /**
   * Guarded transition approved → publish_failed + publish_failed fact, one
   * transaction. `event` is null only when the parent review row is missing
   * (impossible under the replies→reviews FK): the update then commits
   * fact-less, mirroring the pre-BQC-3.3 tolerate-and-log path.
   */
  markPublishFailed(
    reply: Reply,
    updates: ConditionalReplyUpdate,
    event: ReviewReplyPublishFailed | null,
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
