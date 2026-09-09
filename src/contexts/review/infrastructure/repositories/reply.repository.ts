// Review context — Drizzle reply repository implementation
// Per architecture: factory function returning Readonly<{ method }>.

import { and, asc, eq, gt, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  googleReplyObservations,
  replies,
  replyPublicationAttempts,
} from '#/shared/db/schema/review.schema'
import type { ReplyRepository } from '../../application/ports/reply.repository'
import type { Reply, ReplySource } from '../../domain/types'
import {
  reviewId as toReviewId,
  type OrganizationId,
  type ReplyId,
  type ReviewId,
} from '#/shared/domain/ids'
import { replyFromRow, replyToRow } from '../mappers/reply.mapper'
import { buildReplySetClause } from '../reply-set-clause'
import { assertCurrentAiDraftBinding } from '../ai-draft-binding'
import { reviewError } from '../../domain/errors'
import { trace } from '#/shared/observability/trace'

type DuePublicationState =
  'requested' | 'authorized' | 'sending' | 'pending_observation' | 'ambiguous'

async function findDuePublicationBatch(
  db: Database,
  states: readonly DuePublicationState[],
  now: Date,
  cursor: Readonly<{ reconcileDueAt: Date; id: string }> | null,
  limit: number,
): Promise<ReadonlyArray<Reply>> {
  const rows = await db
    .select()
    .from(replies)
    .where(
      and(
        inArray(replies.publicationState, [...states]),
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
}

export const createReplyRepository = (
  db: Database,
  clock: () => Date,
): ReplyRepository => ({
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

  findMilestonesByReviewIds: async (reviewIds, organizationId) => {
    return trace('reply.findMilestonesByReviewIds', async () => {
      if (reviewIds.length === 0) return []
      const rows = await db
        .select({
          reviewId: replies.reviewId,
          firstSubmittedAt: sql<string | null>`min(${replies.submittedAt})`.as(
            'first_submitted_at',
          ),
          firstPublishedAt: sql<string | null>`min(${replies.publishedAt})`.as(
            'first_published_at',
          ),
        })
        .from(replies)
        .where(
          and(
            eq(replies.organizationId, organizationId),
            sql`${replies.reviewId} = ANY(${sql.param(reviewIds.map(String))}::uuid[])`,
          ),
        )
        .groupBy(replies.reviewId)
      return rows.map((row) => ({
        reviewId: toReviewId(row.reviewId),
        firstSubmittedAt: row.firstSubmittedAt ? new Date(row.firstSubmittedAt) : null,
        firstPublishedAt: row.firstPublishedAt ? new Date(row.firstPublishedAt) : null,
      }))
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

  findDuePublicationReconciliationBatch: (now, cursor, limit) =>
    trace('reply.findDuePublicationReconciliationBatch', () =>
      findDuePublicationBatch(
        db,
        ['requested', 'authorized', 'sending', 'pending_observation', 'ambiguous'],
        now,
        cursor,
        limit,
      ),
    ),

  findPublicationAttemptObservationProgress: (attempt) =>
    trace('reply.findPublicationAttemptObservationProgress', async () => {
      // Absent observations deliberately have no "matched attempt" columns:
      // matching is reserved for confirmation. Targeted recording nevertheless
      // guards the exact current attempt, so its immutable source scope and
      // provider-head baseline identify the absences attributable to this attempt.
      const rows = await db
        .select({
          attemptStartedAt: replyPublicationAttempts.createdAt,
          absentObservationCount: sql<number>`count(${googleReplyObservations.id})::int`,
        })
        .from(replyPublicationAttempts)
        .leftJoin(
          googleReplyObservations,
          and(
            eq(
              googleReplyObservations.organizationId,
              replyPublicationAttempts.organizationId,
            ),
            eq(googleReplyObservations.propertyId, replyPublicationAttempts.propertyId),
            eq(googleReplyObservations.reviewId, replyPublicationAttempts.reviewId),
            eq(googleReplyObservations.sourceEpoch, replyPublicationAttempts.sourceEpoch),
            eq(
              googleReplyObservations.materialReviewRevision,
              replyPublicationAttempts.materialReviewRevision,
            ),
            gt(
              googleReplyObservations.observationRevision,
              replyPublicationAttempts.baseObservationRevision,
            ),
            eq(googleReplyObservations.source, 'targeted_reconciliation'),
            eq(googleReplyObservations.state, 'absent'),
          ),
        )
        .where(
          and(
            eq(replyPublicationAttempts.organizationId, attempt.organizationId),
            eq(replyPublicationAttempts.reviewId, attempt.reviewId),
            eq(replyPublicationAttempts.replyId, attempt.replyId),
            eq(replyPublicationAttempts.publicationCycle, attempt.publicationCycle),
            eq(replyPublicationAttempts.attemptNumber, attempt.attemptNumber),
          ),
        )
        .groupBy(replyPublicationAttempts.createdAt)
        .limit(1)
      return rows[0] ?? null
    }),

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
            inArray(replies.publicationState, [
              'requested',
              'authorized',
              'sending',
              'pending_observation',
            ]),
          ),
        )
      return rows.map(replyFromRow)
    })
  },

  upsert: async (reply: Omit<Reply, 'createdAt' | 'updatedAt'>, now?: Date) => {
    return trace('reply.upsert', async () => {
      const row = replyToRow(reply)
      const updatedAt = now ?? clock()
      const result = await db
        .insert(replies)
        .values(row)
        .onConflictDoUpdate({
          target: [replies.reviewId, replies.source, replies.organizationId],
          set: {
            text: row.text,
            replyLanguageTag: row.replyLanguageTag,
            status: row.status,
            approvedBy: row.approvedBy,
            rejectedBy: row.rejectedBy,
            rejectionReason: row.rejectionReason,
            aiGenerated: row.aiGenerated,
            stateRevision: row.stateRevision,
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
      const updatedAt = now ?? clock()
      return db.transaction(async (tx) => {
        const binding = await assertCurrentAiDraftBinding(tx, {
          organizationId,
          replyId: id,
        })
        if (binding === 'stale') return null

        const result = await tx
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
