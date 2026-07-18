// Review context — reply repository port
// Per architecture: "Repository ports for all data access."

import type { Reply, ReplySource, ReplyStatus } from '../../domain/types'
import type {
  PersistedPublicationState,
  PublicationFailureClass,
} from '../../domain/reply-publication-workflow'
import type { OrganizationId, ReplyId, ReviewId } from '#/shared/domain/ids'

export type ConditionalReplyUpdate = Readonly<{
  status?: ReplyStatus
  text?: string
  submittedAt?: Date | null
  approvedBy?: string | null
  approvedAt?: Date | null
  rejectedBy?: string | null
  rejectionReason?: string | null
  publishedAt?: Date | null
  /** BQC-3.8: publication state machine fields (migration 0015). */
  publicationState?: PersistedPublicationState | null
  publicationAttempts?: number
  publicationLastErrorClass?: PublicationFailureClass | null
  reconcileDueAt?: Date | null
}>

export type ReplyRepository = Readonly<{
  findById(id: ReplyId, organizationId: OrganizationId): Promise<Reply | null>
  findByReviewId(
    reviewId: ReviewId,
    organizationId: OrganizationId,
  ): Promise<ReadonlyArray<Reply>>
  findInternalByReviewId(
    reviewId: ReviewId,
    organizationId: OrganizationId,
  ): Promise<Reply | null>
  findGoogleSyncByReviewId(
    reviewId: ReviewId,
    organizationId: OrganizationId,
  ): Promise<Reply | null>
  /**
   * BQC-3.8: keyset-bounded batch of replies whose ambiguous publication is
   * reconcile-due (publication_state='ambiguous' AND reconcile_due_at <= now),
   * ordered (reconcileDueAt ASC, id ASC). `cursor` resumes strictly AFTER
   * (reconcileDueAt, id) — no row is skipped or repeated. Used by the
   * reconcile-ambiguous-publications sweep.
   */
  findAmbiguousPublicationBatch(
    now: Date,
    cursor: Readonly<{ reconcileDueAt: Date; id: string }> | null,
    limit: number,
  ): Promise<ReadonlyArray<Reply>>
  /**
   * BQC-3.8: replies in an active publication state
   * (requested/authorized/sending) for the given reviews — the rows the
   * disconnect/policy cancellation flow must cancel. Bounded by the caller's
   * review batch.
   */
  findPublicationActiveByReviewIds(
    reviewIds: ReadonlyArray<ReviewId>,
    organizationId: OrganizationId,
  ): Promise<ReadonlyArray<Reply>>
  upsert(reply: Omit<Reply, 'createdAt' | 'updatedAt'>, now?: Date): Promise<Reply>
  /**
   * Atomic conditional update — only succeeds if the reply's current status
   * matches one of `expectedStatuses`. Returns null if the status has changed
   * concurrently (TOCTOU guard).
   */
  conditionalUpdate(
    id: ReplyId,
    organizationId: OrganizationId,
    expectedStatuses: readonly ReplyStatus[],
    updates: ConditionalReplyUpdate,
    now?: Date,
  ): Promise<Reply | null>
  deleteById(id: ReplyId, organizationId: OrganizationId): Promise<void>
  deleteByReviewIdAndSource(
    reviewId: ReviewId,
    source: ReplySource,
    organizationId: OrganizationId,
  ): Promise<void>
}>
