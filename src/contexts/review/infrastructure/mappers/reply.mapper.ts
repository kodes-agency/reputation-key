// Review context — row ↔ domain mapper for replies
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { replies } from '#/shared/db/schema/review.schema'
import type { Reply } from '../../domain/types'
import { unbrand, replyId, reviewId, organizationId, userId } from '#/shared/domain/ids'

type ReplyRow = Omit<typeof replies.$inferSelect, 'replyLanguageTag'> &
  Readonly<{ replyLanguageTag?: string | null }>
type ReplyInsertRow = typeof replies.$inferInsert

export const replyFromRow = (row: ReplyRow): Reply => ({
  id: replyId(row.id),
  reviewId: reviewId(row.reviewId),
  organizationId: organizationId(row.organizationId),
  text: row.text,
  replyLanguageTag: row.replyLanguageTag ?? null,
  status: row.status as Reply['status'],
  source: row.source as Reply['source'],
  createdBy: row.createdBy ? userId(row.createdBy) : null,
  approvedBy: row.approvedBy ? userId(row.approvedBy) : null,
  rejectedBy: row.rejectedBy ? userId(row.rejectedBy) : null,
  rejectionReason: row.rejectionReason,
  aiGenerated: row.aiGenerated,
  stateRevision: row.stateRevision,
  submittedAt: row.submittedAt,
  approvedAt: row.approvedAt,
  publishedAt: row.publishedAt,
  publicationState: row.publicationState as Reply['publicationState'],
  publicationCycle: row.publicationCycle,
  publicationAttempts: row.publicationAttempts,
  publicationLastErrorClass:
    row.publicationLastErrorClass as Reply['publicationLastErrorClass'],
  reconcileDueAt: row.reconcileDueAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const replyToRow = (
  reply: Omit<Reply, 'createdAt' | 'updatedAt'>,
): ReplyInsertRow => ({
  id: unbrand(reply.id),
  reviewId: unbrand(reply.reviewId),
  organizationId: unbrand(reply.organizationId),
  text: reply.text,
  replyLanguageTag: reply.replyLanguageTag ?? null,
  status: reply.status,
  source: reply.source,
  createdBy: reply.createdBy != null ? unbrand(reply.createdBy) : null,
  approvedBy: reply.approvedBy != null ? unbrand(reply.approvedBy) : null,
  rejectedBy: reply.rejectedBy != null ? unbrand(reply.rejectedBy) : null,
  rejectionReason: reply.rejectionReason,
  aiGenerated: reply.aiGenerated,
  authorship:
    reply.source === 'google_sync' ? null : reply.aiGenerated ? 'ai_assisted' : 'human',
  stateRevision: reply.stateRevision,
  submittedAt: reply.submittedAt,
  approvedAt: reply.approvedAt,
  publishedAt: reply.publishedAt,
  publicationState: reply.publicationState,
  publicationCycle: reply.publicationCycle,
  publicationAttempts: reply.publicationAttempts,
  publicationLastErrorClass: reply.publicationLastErrorClass,
  reconcileDueAt: reply.reconcileDueAt,
})
