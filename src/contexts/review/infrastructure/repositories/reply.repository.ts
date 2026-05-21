// Review context — Drizzle reply repository implementation
// Per architecture: factory function returning Readonly<{ method }>.

import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { replies } from '#/shared/db/schema/review.schema'
import type { ReplyRepository } from '../../application/ports/reply.repository'
import type { Reply, ReplySource } from '../../domain/types'
import type { OrganizationId, ReplyId, ReviewId } from '#/shared/domain/ids'
import { replyFromRow, replyToRow } from '../mappers/reply.mapper'
import { trace } from '#/shared/observability/trace'

export const createReplyRepository = (db: Database): ReplyRepository => ({
  findById: async (id: ReplyId, organizationId: OrganizationId) => {
    return trace('reply.findById', async () => {
      const rows = await db
        .select()
        .from(replies)
        .where(and(eq(replies.id, id), eq(replies.organizationId, organizationId)))
        .limit(1)
      return rows[0] ? replyFromRow(rows[0]) : null
    })
  },

  findByReviewId: async (reviewId: ReviewId, organizationId: OrganizationId) => {
    return trace('reply.findByReviewId', async () => {
      const rows = await db
        .select()
        .from(replies)
        .where(
          and(eq(replies.reviewId, reviewId), eq(replies.organizationId, organizationId)),
        )
      return rows.map(replyFromRow)
    })
  },

  findInternalByReviewId: async (reviewId: ReviewId, organizationId: OrganizationId) => {
    return trace('reply.findInternalByReviewId', async () => {
      const rows = await db
        .select()
        .from(replies)
        .where(
          and(
            eq(replies.reviewId, reviewId),
            eq(replies.organizationId, organizationId),
            eq(replies.source, 'internal'),
          ),
        )
        .limit(1)
      return rows[0] ? replyFromRow(rows[0]) : null
    })
  },

  findGoogleSyncByReviewId: async (
    reviewId: ReviewId,
    organizationId: OrganizationId,
  ) => {
    return trace('reply.findGoogleSyncByReviewId', async () => {
      const rows = await db
        .select()
        .from(replies)
        .where(
          and(
            eq(replies.reviewId, reviewId),
            eq(replies.organizationId, organizationId),
            eq(replies.source, 'google_sync'),
          ),
        )
        .limit(1)
      return rows[0] ? replyFromRow(rows[0]) : null
    })
  },

  upsert: async (reply: Omit<Reply, 'createdAt' | 'updatedAt'>, now?: Date) => {
    return trace('reply.upsert', async () => {
      const row = replyToRow(reply)
      const updatedAt = now ?? new Date()
      const result = await db
        .insert(replies)
        .values(row)
        .onConflictDoUpdate({
          target: [replies.reviewId, replies.source, replies.organizationId],
          set: {
            text: row.text,
            status: row.status,
            approvedBy: row.approvedBy,
            rejectedBy: row.rejectedBy,
            rejectionReason: row.rejectionReason,
            aiGenerated: row.aiGenerated,
            publishedAt: row.publishedAt,
            updatedAt,
          },
        })
        .returning()

      if (!result[0]) {
        throw new Error('Reply upsert failed — no row returned')
      }
      return replyFromRow(result[0])
    })
  },

  deleteById: async (id: ReplyId, organizationId: OrganizationId) => {
    return trace('reply.deleteById', async () => {
      await db
        .delete(replies)
        .where(and(eq(replies.id, id), eq(replies.organizationId, organizationId)))
    })
  },

  deleteByReviewIdAndSource: async (
    reviewId: ReviewId,
    source: ReplySource,
    organizationId: OrganizationId,
  ) => {
    return trace('reply.deleteByReviewIdAndSource', async () => {
      await db
        .delete(replies)
        .where(
          and(
            eq(replies.reviewId, reviewId),
            eq(replies.source, source),
            eq(replies.organizationId, organizationId),
          ),
        )
    })
  },
})
