// Review context — reply repository port
// Per architecture: "Repository ports for all data access."

import type { Reply, ReplySource } from '../../domain/types'
import type { OrganizationId, ReplyId, ReviewId } from '#/shared/domain/ids'

export type ReplyRepository = Readonly<{
  findByReviewId(
    reviewId: ReviewId,
    organizationId: OrganizationId,
  ): Promise<ReadonlyArray<Reply>>
  findGoogleSyncByReviewId(
    reviewId: ReviewId,
    organizationId: OrganizationId,
  ): Promise<Reply | null>
  upsert(reply: Omit<Reply, 'createdAt' | 'updatedAt'>, now?: Date): Promise<Reply>
  deleteById(id: ReplyId, organizationId: OrganizationId): Promise<void>
  deleteByReviewIdAndSource(
    reviewId: ReviewId,
    source: ReplySource,
    organizationId: OrganizationId,
  ): Promise<void>
}>
