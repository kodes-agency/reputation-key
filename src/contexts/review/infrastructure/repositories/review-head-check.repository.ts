// Review context — Drizzle repository behind the dark head check.
//
// Reads only: the stored copies of the reviews on Google's newest page (with
// their reply heads), the live count and mean rating of the Property's current
// source epoch, and whether a sync failure is still recorded. Its one write is
// the head check's own row in the bounded sync-run history (`review_sync_runs`,
// 30 days, erased with the organization); it writes nothing about a review.

import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { reviews } from '#/shared/db/schema/review.schema'
import {
  googleReplyObservationHeads,
  googleReplyObservations,
} from '#/shared/db/schema/review.schema'
import { reviewSyncRuns, reviewSyncState } from '#/shared/db/schema/review-sync.schema'
import { trace } from '#/shared/observability/trace'
import type {
  ReviewHeadBaseline,
  ReviewHeadCheckOutcome,
  ReviewHeadCheckRepository,
  ReviewHeadRunRecord,
} from '../../application/ports/review-head-check.repository'
import type { HeadComparison, HeadStoredCopy } from '../../domain/head-check'

/** `review_sync_runs.mode` of a head check that persists nothing. */
const HEAD_DARK_RUN_MODE = 'head_dark'

/** review_sync_state is keyed (property_id, source); Google is the only source. */
const SYNC_SOURCE = 'google'

type CopyRow = Readonly<{
  externalId: string | null
  sourceEpoch: number
  sourceUpdatedAt: Date | null
  lastFetchedAt: Date | null
  replyState: string | null
  replyProviderUpdatedAt: Date | null
}>

const toCopy = (row: CopyRow): HeadStoredCopy[] =>
  // A live row always has its Google id; a tombstone does not and is no copy.
  row.externalId === null
    ? []
    : [
        {
          externalId: row.externalId,
          sourceEpoch: row.sourceEpoch,
          sourceUpdatedAt: row.sourceUpdatedAt,
          lastFetchedAt: row.lastFetchedAt,
          reply:
            row.replyState === 'live' || row.replyState === 'absent'
              ? { state: row.replyState, providerUpdatedAt: row.replyProviderUpdatedAt }
              : null,
        },
      ]

/** What the history row's `result` column holds: JSON, so a query can read it. */
const resultJson = (
  outcome: ReviewHeadCheckOutcome,
  comparison: HeadComparison | null,
): string =>
  JSON.stringify(
    comparison === null
      ? { outcome }
      : {
          outcome,
          new: comparison.newCount,
          changed: comparison.changedCount,
          replyChanged: comparison.replyChangedCount,
          leaseRefresh: comparison.leaseRefreshCount,
          wouldPersist: comparison.wouldPersist,
          googleTotal: comparison.googleTotal,
          storedLive: comparison.storedLiveCount,
          totalDifference: comparison.totalDifference,
          googleAverage: comparison.googleAverage,
          storedAverage: comparison.storedAverage,
          averageDifference: comparison.averageDifference,
          hasMore: comparison.hasMore,
        },
  )

/** A page was read from Google (and either compared or refused as out of order). */
const readPage = (outcome: ReviewHeadCheckOutcome): boolean =>
  outcome === 'compared' || outcome === 'order_violation'

const FAILED_AT_PROVIDER: ReadonlySet<ReviewHeadCheckOutcome> = new Set([
  'rate_limited',
  'provider_unavailable',
  'provider_rejected',
  'authorization_changed',
  'malformed_response',
  'error',
])

export const createReviewHeadCheckRepository = (
  db: Database,
): ReviewHeadCheckRepository => {
  const readCopies = async (
    input: Parameters<ReviewHeadCheckRepository['readBaseline']>[0],
  ): Promise<readonly HeadStoredCopy[]> => {
    if (input.externalIds.length === 0) return []
    const rows = await db
      .select({
        externalId: reviews.externalId,
        sourceEpoch: reviews.sourceEpoch,
        sourceUpdatedAt: reviews.sourceUpdatedAt,
        lastFetchedAt: reviews.lastFetchedAt,
        replyState: googleReplyObservationHeads.state,
        replyProviderUpdatedAt: googleReplyObservations.providerUpdatedAt,
      })
      .from(reviews)
      .leftJoin(
        googleReplyObservationHeads,
        and(
          eq(googleReplyObservationHeads.organizationId, reviews.organizationId),
          eq(googleReplyObservationHeads.reviewId, reviews.id),
        ),
      )
      .leftJoin(
        googleReplyObservations,
        and(
          eq(googleReplyObservations.organizationId, reviews.organizationId),
          eq(googleReplyObservations.id, googleReplyObservationHeads.observationId),
        ),
      )
      .where(
        and(
          eq(reviews.organizationId, input.organizationId),
          eq(reviews.propertyId, input.propertyId),
          eq(reviews.platform, 'google'),
          eq(reviews.sourceContentState, 'active'),
          inArray(reviews.externalId, [...input.externalIds]),
        ),
      )
    return rows.flatMap(toCopy)
  }

  const readLiveAggregate = async (
    input: Parameters<ReviewHeadCheckRepository['readBaseline']>[0],
  ): Promise<Pick<ReviewHeadBaseline, 'storedLiveCount' | 'storedAverageRating'>> => {
    const [row] = await db
      .select({
        count: sql<number>`count(*)::int`,
        average: sql<string | null>`avg(${reviews.rating})`,
      })
      .from(reviews)
      .where(
        and(
          eq(reviews.organizationId, input.organizationId),
          eq(reviews.propertyId, input.propertyId),
          eq(reviews.platform, 'google'),
          eq(reviews.sourceEpoch, input.sourceEpoch),
          eq(reviews.sourceContentState, 'active'),
        ),
      )
    return {
      storedLiveCount: row?.count ?? 0,
      storedAverageRating: row?.average == null ? null : Number(row.average),
    }
  }

  return {
    hasOutstandingFailure: async (propertyId) =>
      trace('review.headCheck.hasOutstandingFailure', async () => {
        const [row] = await db
          .select({ errorClass: reviewSyncState.errorClass })
          .from(reviewSyncState)
          .where(
            and(
              eq(reviewSyncState.propertyId, propertyId),
              eq(reviewSyncState.source, SYNC_SOURCE),
            ),
          )
          .limit(1)
        return row?.errorClass != null
      }),

    readBaseline: async (input) =>
      trace('review.headCheck.readBaseline', async () => {
        const [copies, aggregate] = await Promise.all([
          readCopies(input),
          readLiveAggregate(input),
        ])
        return { copies, ...aggregate }
      }),

    recordRun: async (run: ReviewHeadRunRecord) =>
      trace('review.headCheck.recordRun', async () => {
        await db.insert(reviewSyncRuns).values({
          propertyId: run.propertyId,
          source: SYNC_SOURCE,
          mode: HEAD_DARK_RUN_MODE,
          sourceEpoch: run.sourceEpoch,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          pageCount: readPage(run.outcome) ? 1 : 0,
          reviewCount: run.comparison?.listed ?? 0,
          createdCount: run.comparison?.newCount ?? 0,
          updatedCount: run.comparison
            ? run.comparison.wouldPersist - run.comparison.newCount
            : 0,
          deletedCount: 0,
          failedCount: FAILED_AT_PROVIDER.has(run.outcome) ? 1 : 0,
          result: resultJson(run.outcome, run.comparison),
          errorClass: run.outcome === 'compared' ? null : run.outcome,
        })
      }),
  }
}
