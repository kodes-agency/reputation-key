// Review context — reply repository port
// Per architecture: "Repository ports for all data access."

import type { Reply, ReplySource, ReplyStatus } from '../../domain/types'
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
