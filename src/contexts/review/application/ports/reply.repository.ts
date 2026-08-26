// Review context — reply repository port
// Per architecture: "Repository ports for all data access."

import type { Reply, ReplySource, ReplyStatus } from '../../domain/types'
import type {
  PersistedPublicationState,
  PublicationFailureClass,
} from '../../domain/reply-publication-workflow'
import type { OrganizationId, ReplyId, ReviewId } from '#/shared/domain/ids'

/** Content-free reply lifecycle projection used by foreign read models. */
export type ReplyMilestoneRow = Readonly<{
  reviewId: ReviewId
  firstSubmittedAt: Date | null
  firstPublishedAt: Date | null
}>

export type ConditionalReplyUpdate = Readonly<{
  status?: ReplyStatus
  text?: string
  replyLanguageTag?: string | null
  aiGenerated?: boolean
  submittedAt?: Date | null
  approvedBy?: string | null
  approvedAt?: Date | null
  rejectedBy?: string | null
  rejectionReason?: string | null
  publishedAt?: Date | null
  /** BQC-3.8: publication state machine fields (migration 0015). */
  publicationState?: PersistedPublicationState | null
  /** RPL-01: monotonic approval/edit/retry cycle fence. */
  publicationCycle?: number
  publicationAttempts?: number
  publicationLastErrorClass?: PublicationFailureClass | null
  reconcileDueAt?: Date | null
}>

/** Exact compare-and-set command for moving one due provider-read check beyond
 * the sweep's fixed clock. Every fence prevents an older worker from changing
 * the schedule of a newer publication cycle. */
export type DeferPublicationReconciliation = Readonly<{
  replyId: ReplyId
  organizationId: OrganizationId
  publicationCycle: number
  publicationState: 'pending_observation' | 'ambiguous'
  currentDueAt: Date
  nextDueAt: Date
  updatedAt: Date
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
  /**
   * Earliest lifecycle timestamps for a bounded review set. The repository
   * aggregates in one query and never exposes reply text to projection repair.
   */
  findMilestonesByReviewIds(
    reviewIds: ReadonlyArray<ReviewId>,
    organizationId: OrganizationId,
  ): Promise<ReadonlyArray<ReplyMilestoneRow>>
  findGoogleSyncByReviewId(
    reviewId: ReviewId,
    organizationId: OrganizationId,
  ): Promise<Reply | null>
  /**
   * Keyset-bounded batch of provider-pending or ambiguous replies whose
   * provider-read check is due, ordered (reconcileDueAt ASC, id ASC).
   * `cursor` resumes strictly AFTER (reconcileDueAt, id). This is the
   * automatic recovery sweep; operator commands that explicitly request only
   * ambiguous rows use `findAmbiguousPublicationBatch` instead.
   */
  findDuePublicationReconciliationBatch(
    now: Date,
    cursor: Readonly<{ reconcileDueAt: Date; id: string }> | null,
    limit: number,
  ): Promise<ReadonlyArray<Reply>>
  /** One due, keyset-bounded batch restricted to ambiguous outcomes. */
  findAmbiguousPublicationBatch(
    now: Date,
    cursor: Readonly<{ reconcileDueAt: Date; id: string }> | null,
    limit: number,
  ): Promise<ReadonlyArray<Reply>>
  /**
   * Guarded schedule advance after one non-confirming provider read. Returns
   * false when the state, publication cycle, or prior due time moved on; that
   * makes the stale sweep row an already-settled no-op.
   */
  deferPublicationReconciliation(
    command: DeferPublicationReconciliation,
  ): Promise<boolean>
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
