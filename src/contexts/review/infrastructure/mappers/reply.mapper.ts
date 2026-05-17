// Review context — row ↔ domain mapper for replies
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { replies } from '#/shared/db/schema/review.schema'
import type { Reply } from '../../domain/types'
import { replyId, reviewId, organizationId } from '#/shared/domain/ids'

type ReplyRow = typeof replies.$inferSelect
type ReplyInsertRow = typeof replies.$inferInsert

export const replyFromRow = (row: ReplyRow): Reply => ({
  id: replyId(row.id),
  reviewId: reviewId(row.reviewId),
  organizationId: organizationId(row.organizationId),
  text: row.text,
  status: row.status as Reply['status'],
  source: row.source as Reply['source'],
  createdBy: row.createdBy,
  publishedAt: row.publishedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const replyToRow = (reply: Omit<Reply, 'createdAt' | 'updatedAt'>): ReplyInsertRow => ({
  id: reply.id as string,
  reviewId: reply.reviewId as string,
  organizationId: reply.organizationId as string,
  text: reply.text,
  status: reply.status,
  source: reply.source,
  createdBy: reply.createdBy,
  publishedAt: reply.publishedAt,
})
