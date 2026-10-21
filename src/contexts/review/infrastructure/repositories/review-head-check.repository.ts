// Review context — Drizzle repository behind the dark head check.
//
// Reads the stored copies of the reviews on Google's newest page (with their
// reply heads), the live count and mean rating of the Property's current source
// epoch, and whether a sync failure is still recorded. Its writes are the head
// check's own row in the bounded sync-run history (`review_sync_runs`, 30 days,
// erased with the organization) and, in persist mode only, a head fact
// (`recordHeadFact`: Google's count and average, `listing_complete = false`,
// with the verified-snapshot event). It writes nothing about a review; reviews
// are stored through the observation writer.

import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  organizationId as toOrganizationId,
  propertyId as toPropertyId,
} from '#/shared/domain/ids'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { reviews, reviewProviderSnapshotRuns } from '#/shared/db/schema/review.schema'
import {
  googleReplyObservationHeads,
  googleReplyObservations,
} from '#/shared/db/schema/review.schema'
import { reviewGoogleReputationSnapshotFacts as facts } from '#/shared/db/schema/review-reputation.schema'
import { reviewSyncRuns, reviewSyncState } from '#/shared/db/schema/review-sync.schema'
import { trace } from '#/shared/observability/trace'
import type {
  ReviewHeadBaseline,
  ReviewHeadCheckOutcome,
  ReviewHeadCheckRepository,
  ReviewHeadPersistence,
  ReviewHeadRunRecord,
} from '../../application/ports/review-head-check.repository'
import type { HeadComparison, HeadStoredCopy } from '../../domain/head-check'
import { reviewGoogleReputationSnapshotVerified } from '../../domain/events'

/** Snapshot run states in which a run still reads or changes the Property's reviews. */
const ACTIVE_RUN_STATES = ['scanning', 'confirming', 'deleting'] as const

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
  persistence: ReviewHeadPersistence | null,
): string =>
  JSON.stringify(
    comparison === null
      ? { outcome }
      : {
          outcome,
          ...(persistence === null
            ? {}
            : {
                persisted: persistence.outcome,
                storedNew: persistence.storedNew,
                storedOther: persistence.storedOther,
                failed: persistence.failed,
                factWritten: persistence.factWritten,
              }),
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

    readPersistState: async (input) =>
      trace('review.headCheck.readPersistState', async () => {
        const inEpoch = and(
          eq(facts.organizationId, input.organizationId),
          eq(facts.propertyId, input.propertyId),
          eq(facts.sourceEpoch, input.sourceEpoch),
        )
        const [completed] = await db
          .select({ one: sql<number>`1` })
          .from(facts)
          .where(and(inEpoch, eq(facts.listingComplete, true)))
          .limit(1)
        const [active] = await db
          .select({ one: sql<number>`1` })
          .from(reviewProviderSnapshotRuns)
          .where(
            and(
              eq(reviewProviderSnapshotRuns.organizationId, input.organizationId),
              eq(reviewProviderSnapshotRuns.propertyId, input.propertyId),
              eq(reviewProviderSnapshotRuns.sourceEpoch, input.sourceEpoch),
              inArray(reviewProviderSnapshotRuns.state, [...ACTIVE_RUN_STATES]),
              // A run past its expiry is dead: the next sync closes it, and it
              // must not hold head checks off in the meantime.
              gt(reviewProviderSnapshotRuns.expiresAt, input.now),
            ),
          )
          .limit(1)
        const observedAt = sql<Date>`COALESCE(${facts.numbersObservedAt}, ${facts.evaluatedAt})`
        const [newest] = await db
          .select({
            reviewCount: facts.reviewCount,
            averageRating: facts.averageRating,
            observedAt,
          })
          .from(facts)
          .where(inEpoch)
          .orderBy(desc(observedAt), desc(facts.evaluatedAt))
          .limit(1)
        return {
          hasCompletedListing: completed !== undefined,
          snapshotActive: active !== undefined,
          newestFact:
            newest === undefined
              ? null
              : {
                  reviewCount: newest.reviewCount,
                  averageRating: newest.averageRating,
                  observedAt: new Date(newest.observedAt),
                },
        }
      }),

    recordHeadFact: async (input) =>
      trace('review.headCheck.recordHeadFact', async () => {
        await db.transaction(async (tx) => {
          const stamped = await tx.execute(
            sql`SELECT transaction_timestamp() AS evaluated_at`,
          )
          const written = (stamped.rows[0] as { evaluated_at: Date | string })
            .evaluated_at
          const evaluatedAt = written instanceof Date ? written : new Date(written)
          const verified = reviewGoogleReputationSnapshotVerified({
            organizationId: toOrganizationId(input.organizationId),
            propertyId: toPropertyId(input.propertyId),
            sourceEpoch: input.sourceEpoch,
            runId: input.factId,
            reviewCount: input.reviewCount,
            averageRating: input.averageRating,
            evaluatedAt,
            numbersObservedAt: input.numbersObservedAt,
            occurredAt: evaluatedAt,
          })
          await tx.insert(facts).values({
            runId: input.factId,
            eventId: verified.eventId,
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            sourceEpoch: input.sourceEpoch,
            reviewCount: input.reviewCount,
            averageRating: input.averageRating,
            evaluatedAt,
            listingComplete: false,
            numbersObservedAt: input.numbersObservedAt,
          })
          await insertOutboxRow(tx, verified, { recordedAt: evaluatedAt })
        })
      }),

    recordRun: async (run: ReviewHeadRunRecord) =>
      trace('review.headCheck.recordRun', async () => {
        const stored = run.mode === 'head'
        const persistence = run.persistence ?? null
        await db.insert(reviewSyncRuns).values({
          propertyId: run.propertyId,
          source: SYNC_SOURCE,
          mode: run.mode ?? 'head_dark',
          sourceEpoch: run.sourceEpoch,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          pageCount: readPage(run.outcome) ? 1 : 0,
          reviewCount: run.comparison?.listed ?? 0,
          // A dark check records what it WOULD store; a persisting one records
          // what it actually stored.
          createdCount: stored
            ? (persistence?.storedNew ?? 0)
            : (run.comparison?.newCount ?? 0),
          updatedCount: stored
            ? (persistence?.storedOther ?? 0)
            : run.comparison
              ? run.comparison.wouldPersist - run.comparison.newCount
              : 0,
          deletedCount: 0,
          failedCount:
            (FAILED_AT_PROVIDER.has(run.outcome) ? 1 : 0) + (persistence?.failed ?? 0),
          result: resultJson(run.outcome, run.comparison, persistence),
          errorClass: run.outcome === 'compared' ? null : run.outcome,
        })
      }),
  }
}
