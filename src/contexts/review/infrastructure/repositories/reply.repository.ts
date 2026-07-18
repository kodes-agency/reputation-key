// Review context — Drizzle reply repository implementation
// Per architecture: factory function returning Readonly<{ method }>.

import { and, asc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { replies } from '#/shared/db/schema/review.schema'
import type { ReplyRepository } from '../../application/ports/reply.repository'
import type { Reply, ReplySource } from '../../domain/types'
import type { OrganizationId, ReplyId, ReviewId } from '#/shared/domain/ids'
import { replyFromRow, replyToRow } from '../mappers/reply.mapper'
import { buildReplySetClause } from '../reply-set-clause'
import { reviewError } from '../../domain/errors'
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

  findAmbiguousPublicationBatch: async (now, cursor, limit) => {
    return trace('reply.findAmbiguousPublicationBatch', async () => {
      const rows = await db
        .select()
        .from(replies)
        .where(
          and(
            eq(replies.publicationState, 'ambiguous'),
            isNotNull(replies.reconcileDueAt),
            lte(replies.reconcileDueAt, now),
            cursor
              ? // Keyset: strictly after (reconcileDueAt, id) — no skip/repeat.
                sql`(${replies.reconcileDueAt}, ${replies.id}) > (${cursor.reconcileDueAt}, ${cursor.id})`
              : undefined,
          ),
        )
        .orderBy(asc(replies.reconcileDueAt), asc(replies.id))
        .limit(limit)
      return rows.map(replyFromRow)
    })
  },

  findPublicationActiveByReviewIds: async (reviewIds, organizationId) => {
    return trace('reply.findPublicationActiveByReviewIds', async () => {
      if (reviewIds.length === 0) return []
      const rows = await db
        .select()
        .from(replies)
        .where(
          and(
            inArray(replies.reviewId, [...reviewIds]),
            eq(replies.organizationId, organizationId),
            inArray(replies.publicationState, ['requested', 'authorized', 'sending']),
          ),
        )
      return rows.map(replyFromRow)
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
            submittedAt: row.submittedAt,
            approvedAt: row.approvedAt,
            publishedAt: row.publishedAt,
            updatedAt,
          },
        })
        .returning()

      if (!result[0]) {
        throw reviewError('repo_upsert_failed', 'Reply upsert failed — no row returned')
      }
      return replyFromRow(result[0])
    })
  },

  conditionalUpdate: async (id, organizationId, expectedStatuses, updates, now) => {
    return trace('reply.conditionalUpdate', async () => {
      const updatedAt = now ?? new Date()

      const result = await db
        .update(replies)
        .set(buildReplySetClause(updates, updatedAt))
        .where(
          and(
            eq(replies.id, id),
            eq(replies.organizationId, organizationId),
            inArray(replies.status, [...expectedStatuses]),
          ),
        )
        .returning()

      // No row matched → status changed concurrently, TOCTOU guard triggered
      return result[0] ? replyFromRow(result[0]) : null
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
