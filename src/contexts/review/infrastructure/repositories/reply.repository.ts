// Review context — Drizzle reply repository implementation
// Per architecture: factory function returning Readonly<{ method }>.

import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  googleReplyObservationHeads,
  googleReplyObservations,
  replies,
  replyPublicationAttempts,
  replyPublicationAuthorizations,
  reviews,
} from '#/shared/db/schema/review.schema'
import { properties } from '#/shared/db/schema/property.schema'
import type {
  GoogleReplyHeadRow,
  ReplyMilestoneRow,
  ReplyRepository,
  ReplyStageRow,
  ReplyStateRow,
} from '../../application/ports/reply.repository'
import type { Reply, ReplySource } from '../../domain/types'
import {
  propertyId as toPropertyId,
  replyId as toReplyId,
  reviewId as toReviewId,
  type OrganizationId,
  type PropertyId,
  type ReplyId,
  type ReviewId,
} from '#/shared/domain/ids'
import { replyFromRow, replyToRow } from '../mappers/reply.mapper'
import { guardedReplyUpdate } from '../reply-write-guards'
import { reviewError } from '../../domain/errors'
import {
  hasPublicationRecord,
  replyCommandMayStart,
} from '../../domain/reply-command-preconditions'
import { trace } from '#/shared/observability/trace'
import {
  AWAITING_REPLY_STATUSES,
  UNCERTAIN_REPLY_STILL_CHECKED,
  WAITING_REPLY_STATUSES,
} from '#/shared/domain/reply-queue-stage'

/**
 * D8: SQL form of `replyQueueStage` (`#/shared/domain/reply-queue-stage.ts`),
 * built from the same constants so the queue lists/counts and the browser's
 * optimistic matcher cannot drift. `status` is a pg enum, hence the text casts.
 * reply.repository.test.ts enumerates every status × publication state × due
 * time against the shared rule and the client helper.
 */
const replyQueueStageSql = sql<ReplyStageRow['stage']>`CASE
  WHEN ${replies.status}::text = ANY(${sql.param([...AWAITING_REPLY_STATUSES])}::text[])
    THEN 'awaiting'
  WHEN ${replies.status}::text = ANY(${sql.param([...WAITING_REPLY_STATUSES])}::text[])
    THEN 'waiting'
  WHEN ${replies.status}::text = ${UNCERTAIN_REPLY_STILL_CHECKED.status}
    AND ${replies.publicationState} = ${UNCERTAIN_REPLY_STILL_CHECKED.publicationState}
    AND ${replies.reconcileDueAt} IS NOT NULL
    THEN 'waiting'
  ELSE 'needs_reply'
END`

/**
 * A review's first published reply is the earlier of RepKey's own and the one
 * Google shows now; a review answered only on Google gets a row of its own.
 */
function mergeGoogleReplyMilestones(
  fromReplies: ReadonlyArray<ReplyMilestoneRow>,
  onGoogle: ReadonlyArray<Readonly<{ reviewId: ReviewId; publishedAt: Date }>>,
): ReadonlyArray<ReplyMilestoneRow> {
  const merged = new Map<string, ReplyMilestoneRow>(
    fromReplies.map((row) => [row.reviewId, row]),
  )
  for (const { reviewId, publishedAt } of onGoogle) {
    const row = merged.get(reviewId)
    const earliest =
      row?.firstPublishedAt && row.firstPublishedAt <= publishedAt
        ? row.firstPublishedAt
        : publishedAt
    merged.set(reviewId, {
      reviewId,
      firstSubmittedAt: row?.firstSubmittedAt ?? null,
      firstPublishedAt: earliest,
    })
  }
  return [...merged.values()]
}

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
      const ids = sql.param(reviewIds.map(String))
      const [rows, onGoogle] = await Promise.all([
        db
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
              sql`${replies.reviewId} = ANY(${ids}::uuid[])`,
            ),
          )
          .groupBy(replies.reviewId),
        // A reply written on Google has no `replies` row: it is the
        // observation a live head points at. Its time is the one Google
        // reports for it, else when RepKey read it (the Inbox reply lookup's
        // rule), never a guess.
        db
          .select({
            reviewId: googleReplyObservationHeads.reviewId,
            publishedAt: sql<string>`coalesce(${googleReplyObservations.providerUpdatedAt}, ${googleReplyObservations.observedAt})`,
          })
          .from(googleReplyObservationHeads)
          .innerJoin(
            googleReplyObservations,
            and(
              eq(googleReplyObservations.id, googleReplyObservationHeads.observationId),
              eq(googleReplyObservations.organizationId, organizationId),
            ),
          )
          .where(
            and(
              eq(googleReplyObservationHeads.organizationId, organizationId),
              eq(googleReplyObservationHeads.state, 'live'),
              sql`${googleReplyObservationHeads.reviewId} = ANY(${ids}::uuid[])`,
            ),
          ),
      ])
      return mergeGoogleReplyMilestones(
        rows.map((row) => ({
          reviewId: toReviewId(row.reviewId),
          firstSubmittedAt: row.firstSubmittedAt ? new Date(row.firstSubmittedAt) : null,
          firstPublishedAt: row.firstPublishedAt ? new Date(row.firstPublishedAt) : null,
        })),
        onGoogle.map((row) => ({
          reviewId: toReviewId(row.reviewId),
          publishedAt: new Date(row.publishedAt),
        })),
      )
    })
  },

  findCurrentGoogleReplyHeadsByReviewIds: async (reviewIds, organizationId) => {
    return trace('reply.findCurrentGoogleReplyHeadsByReviewIds', async () => {
      if (reviewIds.length === 0) return []
      const rows = await db
        .select({
          reviewId: googleReplyObservationHeads.reviewId,
          propertyId: googleReplyObservationHeads.propertyId,
          observationRevision: googleReplyObservationHeads.observationRevision,
          sourceEpoch: googleReplyObservationHeads.sourceEpoch,
          materialReviewRevision: googleReplyObservationHeads.materialReviewRevision,
          state: googleReplyObservations.state,
          change: googleReplyObservations.change,
          resolution: googleReplyObservations.resolution,
          provenance: googleReplyObservations.provenance,
          matchedReplyId: googleReplyObservations.matchedReplyId,
          matchedPublicationCycle: googleReplyObservations.matchedPublicationCycle,
          observedAt: googleReplyObservations.observedAt,
        })
        .from(googleReplyObservationHeads)
        .innerJoin(
          googleReplyObservations,
          and(
            eq(googleReplyObservations.id, googleReplyObservationHeads.observationId),
            eq(googleReplyObservations.organizationId, organizationId),
          ),
        )
        .where(
          and(
            eq(googleReplyObservationHeads.organizationId, organizationId),
            sql`${googleReplyObservationHeads.reviewId} = ANY(${sql.param(reviewIds.map(String))}::uuid[])`,
          ),
        )
      return rows.map((row): GoogleReplyHeadRow => ({
        ...row,
        reviewId: toReviewId(row.reviewId),
        propertyId: toPropertyId(row.propertyId),
        state: row.state as GoogleReplyHeadRow['state'],
        change: row.change as GoogleReplyHeadRow['change'],
        resolution: row.resolution as GoogleReplyHeadRow['resolution'],
        provenance: row.provenance as GoogleReplyHeadRow['provenance'],
        matchedReplyId: row.matchedReplyId ? toReplyId(row.matchedReplyId) : null,
      }))
    })
  },

  findStatesByReviewIds: async (reviewIds, organizationId) => {
    return trace('reply.findStatesByReviewIds', async () => {
      if (reviewIds.length === 0) return []
      const rows = await db
        .select({
          reviewId: replies.reviewId,
          source: replies.source,
          status: replies.status,
          publicationState: replies.publicationState,
          publicationLastErrorClass: replies.publicationLastErrorClass,
          reconcileDueAt: replies.reconcileDueAt,
          updatedAt: replies.updatedAt,
        })
        .from(replies)
        .where(
          and(
            eq(replies.organizationId, organizationId),
            sql`${replies.reviewId} = ANY(${sql.param(reviewIds.map(String))}::uuid[])`,
          ),
        )
        .orderBy(asc(replies.reviewId), asc(replies.source))
      return rows.map((row): ReplyStateRow => ({
        ...row,
        reviewId: toReviewId(row.reviewId),
        publicationState: row.publicationState as ReplyStateRow['publicationState'],
        publicationLastErrorClass:
          row.publicationLastErrorClass as ReplyStateRow['publicationLastErrorClass'],
      }))
    })
  },

  findReviewIdsByReplyStage: async (
    organizationId: OrganizationId,
    propertyIds?: ReadonlyArray<PropertyId>,
  ) => {
    return trace('reply.findReviewIdsByReplyStage', async () => {
      if (propertyIds?.length === 0) return []
      const rows = await db
        .select({
          reviewId: replies.reviewId,
          source: replies.source,
          stage: replyQueueStageSql,
        })
        .from(replies)
        .innerJoin(
          reviews,
          and(
            eq(reviews.id, replies.reviewId),
            eq(reviews.organizationId, replies.organizationId),
          ),
        )
        .where(
          and(
            eq(replies.organizationId, organizationId),
            propertyIds
              ? inArray(reviews.propertyId, [...propertyIds] as string[])
              : undefined,
          ),
        )
        .orderBy(asc(replies.reviewId), asc(replies.source))
      return rows.map((row): ReplyStageRow => ({
        ...row,
        reviewId: toReviewId(row.reviewId),
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

  // D3 keeps a deferred uncertain send approved/sending with a one-minute
  // reconcile_due_at, so `sending` must stay in this list for the sweep to
  // read it again.
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

  findCurrentPublicationAttemptStartedAt: (attempt) =>
    trace('reply.findCurrentPublicationAttemptStartedAt', async () => {
      // markPublicationSending inserts this row in the claim transaction with
      // created_at = the claim time, so it is the durable start of the send.
      const rows = await db
        .select({ attemptStartedAt: replyPublicationAttempts.createdAt })
        .from(replyPublicationAttempts)
        .where(
          and(
            eq(replyPublicationAttempts.organizationId, attempt.organizationId),
            eq(replyPublicationAttempts.reviewId, attempt.reviewId),
            eq(replyPublicationAttempts.replyId, attempt.replyId),
            eq(replyPublicationAttempts.publicationCycle, attempt.publicationCycle),
            eq(replyPublicationAttempts.attemptNumber, attempt.attemptNumber),
          ),
        )
        .limit(1)
      return rows[0]?.attemptStartedAt ?? null
    }),

  findUndispatchedPublicationsByReviewIds: async (reviewIds, organizationId) => {
    return trace('reply.findUndispatchedPublicationsByReviewIds', async () => {
      if (reviewIds.length === 0) return []
      const rows = await db
        .select()
        .from(replies)
        .where(
          and(
            inArray(replies.reviewId, [...reviewIds]),
            eq(replies.organizationId, organizationId),
            // A claimed or provider-accepted cycle may already be on Google.
            inArray(replies.publicationState, ['requested', 'authorized']),
          ),
        )
      return rows.map(replyFromRow)
    })
  },

  findUnsendablePublicationsByPropertyId: async (propertyId, organizationId, limit) => {
    return trace('reply.findUnsendablePublicationsByPropertyId', async () => {
      // The cycle's own authorized epoch is what the worker and the provider
      // authorizer check; a pre-RPL cycle without an authorization row falls
      // back to its Review's epoch.
      const cycleEpoch = sql`COALESCE(${replyPublicationAuthorizations.sourceEpoch}, ${reviews.sourceEpoch})`
      const rows = await db
        .select({ reply: replies })
        .from(replies)
        .innerJoin(
          reviews,
          and(
            eq(reviews.id, replies.reviewId),
            eq(reviews.organizationId, replies.organizationId),
          ),
        )
        .innerJoin(
          properties,
          and(
            eq(properties.id, reviews.propertyId),
            eq(properties.organizationId, reviews.organizationId),
          ),
        )
        .leftJoin(
          replyPublicationAuthorizations,
          and(
            eq(replyPublicationAuthorizations.replyId, replies.id),
            eq(replyPublicationAuthorizations.publicationCycle, replies.publicationCycle),
          ),
        )
        .where(
          and(
            eq(replies.organizationId, organizationId),
            eq(reviews.propertyId, propertyId),
            inArray(replies.publicationState, ['requested', 'authorized']),
            or(
              ne(properties.lifecycleState, 'active'),
              isNotNull(properties.deletedAt),
              sql`${cycleEpoch} < ${properties.sourceEpoch}`,
            ),
          ),
        )
        .orderBy(asc(replies.id))
        .limit(limit)
      return rows.map((row) => replyFromRow(row.reply))
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
            templateId: row.templateId,
            templateVersion: row.templateVersion,
            templateLayer: row.templateLayer,
            templateRef: row.templateRef,
            templateRevision: row.templateRevision,
            templateWordingKey: row.templateWordingKey,
            voiceDigest: row.voiceDigest,
            voiceChoices: row.voiceChoices,
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

  createDraft: async (reply: Omit<Reply, 'createdAt' | 'updatedAt'>) => {
    return trace('reply.createDraft', async () => {
      if (reply.status !== 'draft' || hasPublicationRecord(reply)) {
        throw reviewError(
          'invalid_input',
          'A new reply starts as a draft with no publication',
        )
      }
      // Never ON CONFLICT DO UPDATE: a reply created since the caller looked
      // may already be submitted or confirmed, and an insert must not rewrite it.
      const result = await db
        .insert(replies)
        .values(replyToRow(reply))
        .onConflictDoNothing({
          target: [replies.reviewId, replies.source, replies.organizationId],
        })
        .returning()
      return result[0] ? replyFromRow(result[0]) : null
    })
  },

  saveDraft: async (reply, content, now) => {
    return trace('reply.saveDraft', async () => {
      const updatedAt = now ?? clock()
      // The guard is the `save_draft` precondition as a compare-and-set: a
      // reply that is waiting for approval, being published or published
      // matches no row, whoever calls. A save never reads the AI draft
      // binding: a manager typing over AI text, however old, makes the reply
      // theirs, and the guard records it as human-authored
      // (domain/reply-ai-text.ts).
      return db.transaction((tx) =>
        guardedReplyUpdate(
          tx,
          reply,
          'save_draft',
          { ...content, status: 'draft', rejectedBy: null, rejectionReason: null },
          updatedAt,
        ),
      )
    })
  },

  deleteDraft: async (reply: Reply) => {
    return trace('reply.deleteDraft', async () => {
      // A reply that was ever authorized keeps its authorization and attempt
      // rows (ON DELETE RESTRICT), so it is refused here, not left to fail on
      // the foreign key.
      if (!replyCommandMayStart('delete', reply)) return false
      const deleted = await db
        .delete(replies)
        .where(
          and(
            eq(replies.id, reply.id),
            eq(replies.organizationId, reply.organizationId),
            // Still the reply that was read, and still without a publication.
            eq(replies.status, reply.status),
            isNull(replies.publicationState),
            eq(replies.publicationCycle, 0),
          ),
        )
        .returning({ id: replies.id })
      return deleted.length > 0
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
