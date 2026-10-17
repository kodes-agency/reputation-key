// Review context — ReviewServingStats implementation (BQC-5.5).
//
// Review-owned governed aggregate serving reads over reviews, replies and
// Google's reply truth (the current reply observation). The SQL moved here
// from the dashboard review-stats adapter, with ONE behavior change (the point
// of the move): EVERY review-content read now applies THE source-eligibility
// predicate — `contentExpiresAt IS NOT NULL AND contentExpiresAt > now` with
// `now` INJECTED from the composition clock (BQC-5.3 — never DB now()). This
// mirrors isContentEligibleForRead (application/source-content-lifecycle,
// ADR 0031): clock-less rows fail closed. The reply joins apply the same
// eligibility on the review side — a reply of an expired review is not
// servable.
//
// A review is replied when Google shows a reply to it (its observation head
// is `live`) or RepKey published one. A reply written directly on Google is
// only an observation: the legacy `google_sync` mirror row is deleted once the
// observation is recorded, so `replies` alone undercounts.
//
// These reads take only the head's state and Google's reply time, never reply
// text, so they are gated by the review's eligibility alone. The Inbox shows
// the reply text and reads it through `createEligibleGoogleReplyReads`
// (application/eligible-reads.ts), which also drops an observation whose own
// content clock has lapsed. That clock is set once when the observation is
// recorded: a later fetch that finds the same reply restates the head without
// moving it, while the review's clock moves on every fetch. So a servable
// review whose reply has not changed for the cache window counts as replied
// here although the Inbox no longer shows its Google reply text.
//
// F055 NOTE: reviews table has no deletedAt column — soft-delete filtering is
// not needed here. If a soft-delete column is added, filter it in the
// where-builders below (one place per query family).

import type { Database } from '#/shared/db'
import {
  googleReplyObservationHeads,
  googleReplyObservations,
  properties,
  reviews,
  replies,
} from '#/shared/db/schema'
import { and, count, avg, eq, gte, gt, lt, desc, isNotNull, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { trace } from '#/shared/observability/trace'
import type { Clock } from '#/shared/domain/clock'
import type {
  ReviewServingStats,
  ServingRecentReviewRow,
} from '../application/ports/serving-stats.port'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

/**
 * THE serving-eligibility predicate (ADR 0031). Kept next to the queries so
 * every serving read composes it; the dashboard's own attention-signals copy
 * is pinned equivalent by an integration test over a shared fixture set. The
 * rating goal reads (google-rating-reads.ts) compose this one.
 */
export const contentEligible = (now: Date) =>
  and(
    eq(reviews.sourceContentState, 'active'),
    isNotNull(reviews.rating),
    isNotNull(reviews.reviewedAt),
    isNotNull(reviews.contentExpiresAt),
    gt(reviews.contentExpiresAt, now),
  )

/** Period aggregate scope: tenant + property + reviewedAt range + eligibility. */
function servingPeriodWhere(
  organizationId: OrganizationId,
  propertyId: PropertyId,
  startDate: Date,
  endDate: Date,
  now: Date,
) {
  return and(
    eq(reviews.organizationId, organizationId),
    eq(reviews.propertyId, propertyId),
    gte(reviews.reviewedAt, startDate),
    lt(reviews.reviewedAt, endDate),
    contentEligible(now),
  )
}

/** Recent-reviews scope: tenant + property + eligibility (no date range). */
function servingRecentWhere(
  organizationId: OrganizationId,
  propertyId: PropertyId,
  now: Date,
) {
  return and(
    eq(reviews.organizationId, organizationId),
    eq(reviews.propertyId, propertyId),
    contentEligible(now),
  )
}

/**
 * The calendar day of a review in its Property's zone. The window of every
 * period is opened at a Property-local instant and Portal Results count
 * Property-local days, so the series is bucketed the same way: a review written
 * at 18:30 in Los Angeles belongs to that day, not to the UTC day after it. The
 * pool pins the session zone to UTC, so a bare DATE() would be the UTC day.
 */
const reviewDate = sql`DATE(${reviews.reviewedAt} AT TIME ZONE ${properties.timezone})`

type DailySeriesRow = Readonly<{ date: string; value: number | null }>

/**
 * THE daily-series skeleton over the serving scope: one row per reviewedAt
 * day of the Property's calendar, ordered chronologically. `aggregate` picks
 * the per-day value — avgRating (trend) or count (volume); consumers
 * round/project.
 */
async function queryDailySeries(
  db: Database,
  where: SQL | undefined,
  aggregate: 'avgRating' | 'count',
): Promise<readonly DailySeriesRow[]> {
  const rows = await db
    .select({
      date: sql<string>`TO_CHAR(${reviewDate}, 'YYYY-MM-DD')`.as('date'),
      value: aggregate === 'avgRating' ? avg(reviews.rating) : count(),
    })
    .from(reviews)
    .innerJoin(
      properties,
      and(
        eq(properties.id, reviews.propertyId),
        eq(properties.organizationId, reviews.organizationId),
      ),
    )
    .where(where)
    .groupBy(reviewDate)
    .orderBy(reviewDate)
  return rows.map((r) => ({
    date: r.date,
    value: r.value != null ? Number(r.value) : null,
  }))
}

/**
 * Per review, the `published_at` of its published reply: RepKey's own reply
 * first, else a legacy Google mirror's. For RepKey's reply that is when RepKey
 * confirmed it on Google: normally just after posting it, later when a publish
 * had an uncertain outcome, and again after an edit sent from RepKey. Read
 * LATERAL, one index lookup per review. An aggregate with no GROUP BY always
 * yields a row, so the join keeps every review; `publishedAt` is null when
 * nothing was published. Drizzle names the column unqualified in the outer
 * query, hence a name no joined table has.
 */
function publishedRepKeyReply(db: Database, organizationId: OrganizationId) {
  return db
    .select({
      publishedAt: sql<string | null>`COALESCE(
        max(${replies.publishedAt}) FILTER (WHERE ${replies.source} = 'internal'),
        max(${replies.publishedAt})
      )`.as('repkey_reply_published_at'),
    })
    .from(replies)
    .where(
      and(
        eq(replies.reviewId, reviews.id),
        eq(replies.organizationId, organizationId),
        eq(replies.status, 'published'),
        isNotNull(replies.publishedAt),
      ),
    )
    .as('published_repkey_reply')
}

/**
 * The review's current observation head, when Google shows a reply. The
 * organization predicates here and in `headObservation` restate what the
 * tenant foreign keys (head → observation → review) already guarantee; they
 * are kept so no join relies on that alone.
 */
const liveGoogleReplyHead = (organizationId: OrganizationId) =>
  and(
    eq(googleReplyObservationHeads.reviewId, reviews.id),
    eq(googleReplyObservationHeads.organizationId, organizationId),
    eq(googleReplyObservationHeads.propertyId, reviews.propertyId),
    eq(googleReplyObservationHeads.state, 'live'),
  )

/** The observation that head points at, which carries Google's reply time. */
const headObservation = (organizationId: OrganizationId) =>
  and(
    eq(googleReplyObservations.id, googleReplyObservationHeads.observationId),
    eq(googleReplyObservations.organizationId, organizationId),
    eq(googleReplyObservations.reviewId, reviews.id),
  )

/** A recent review as selected: both columns are nullable in the schema. */
type RecentReviewSelection = Omit<ServingRecentReviewRow, 'rating' | 'reviewedAt'> &
  Readonly<{ rating: number | null; reviewedAt: Date | null }>

/**
 * The serving row of a selected recent review. `contentEligible` already
 * requires a rating and a review instant, so every selected row has both; this
 * says so to the type, where a `sql<T>` cast used to. A row without one is not
 * servable content and is left out.
 */
const servableRecentReview = (row: RecentReviewSelection): ServingRecentReviewRow[] =>
  row.rating === null || row.reviewedAt === null
    ? []
    : [{ ...row, rating: row.rating, reviewedAt: row.reviewedAt }]

export const createServingStats = (deps: {
  db: Database
  clock: Clock
}): ReviewServingStats => ({
  /**
   * RepKey's own count and average of the reviews it holds and may serve for
   * the period. It is not the number Google shows: Google's own rating and
   * count are the Current on Google snapshot (Reporting), which every headline
   * rating reads (ADR 0067, decision 16). The Ratings page's period averages
   * come from here.
   */
  async getPeriodStats(organizationId, propertyId, startDate, endDate) {
    return trace('review.servingStats.getPeriodStats', async () => {
      const rows = await deps.db
        .select({ count: count(), avgRating: avg(reviews.rating) })
        .from(reviews)
        .where(
          servingPeriodWhere(
            organizationId,
            propertyId,
            startDate,
            endDate,
            deps.clock(),
          ),
        )

      return {
        count: Number(rows[0]?.count ?? 0),
        avgRating: rows[0]?.avgRating != null ? Number(rows[0].avgRating) : null,
      }
    })
  },

  async getRatingDistribution(organizationId, propertyId, startDate, endDate) {
    return trace('review.servingStats.getRatingDistribution', async () => {
      const rows = await deps.db
        .select({ stars: reviews.rating, count: count() })
        .from(reviews)
        .where(
          servingPeriodWhere(
            organizationId,
            propertyId,
            startDate,
            endDate,
            deps.clock(),
          ),
        )
        .groupBy(reviews.rating)

      const bucketMap = new Map(rows.map((r) => [r.stars, r.count]))
      return [1, 2, 3, 4, 5].map((stars) => ({
        stars,
        count: bucketMap.get(stars) ?? 0,
      }))
    })
  },

  async getRatingTrend(organizationId, propertyId, startDate, endDate) {
    return trace('review.servingStats.getRatingTrend', async () => {
      const rows = await queryDailySeries(
        deps.db,
        servingPeriodWhere(organizationId, propertyId, startDate, endDate, deps.clock()),
        'avgRating',
      )
      return rows.map((r) => ({
        date: r.date,
        avgRating: Math.round((r.value ?? 0) * 100) / 100,
      }))
    })
  },

  async getReviewVolume(organizationId, propertyId, startDate, endDate) {
    return trace('review.servingStats.getReviewVolume', async () => {
      const rows = await queryDailySeries(
        deps.db,
        servingPeriodWhere(organizationId, propertyId, startDate, endDate, deps.clock()),
        'count',
      )
      return rows.map((r) => ({ date: r.date, count: r.value ?? 0 }))
    })
  },

  /**
   * Of the period's servable reviews, how many have a reply on Google (a live
   * observation head, or a reply RepKey published) and how long a reply took.
   * Reviews are counted, never replies, so a review answered both ways counts
   * once. A reply's time is RepKey's `published_at` (see
   * `publishedRepKeyReply`), else the time Google reports for the reply (its
   * last edit). A replied review with neither still counts for the rate but
   * not the average: `observed_at` is when RepKey read Google, which for
   * history imported later would be far from the reply.
   */
  async getReplyPerformance(organizationId, propertyId, startDate, endDate) {
    return trace('review.servingStats.getReplyPerformance', async () => {
      const repKeyReply = publishedRepKeyReply(deps.db, organizationId)
      const replyAt = sql`COALESCE(${repKeyReply.publishedAt}, ${googleReplyObservations.providerUpdatedAt})`
      const rows = await deps.db
        .select({
          totalReviews: count(),
          repliedCount: sql<string>`count(*) FILTER (
            WHERE ${repKeyReply.publishedAt} IS NOT NULL
              OR ${googleReplyObservationHeads.reviewId} IS NOT NULL
          )`,
          timedCount: count(replyAt),
          avgHours: avg(
            sql`EXTRACT(EPOCH FROM (${replyAt} - ${reviews.reviewedAt})) / 3600`,
          ),
        })
        .from(reviews)
        .leftJoinLateral(repKeyReply, sql`true`)
        .leftJoin(googleReplyObservationHeads, liveGoogleReplyHead(organizationId))
        .leftJoin(googleReplyObservations, headObservation(organizationId))
        // BQC-5.5: a reply of an expired review is not servable.
        .where(
          servingPeriodWhere(
            organizationId,
            propertyId,
            startDate,
            endDate,
            deps.clock(),
          ),
        )

      const row = rows[0]
      const timedCount = Number(row?.timedCount ?? 0)
      return {
        totalReviews: Number(row?.totalReviews ?? 0),
        repliedCount: Number(row?.repliedCount ?? 0),
        avgReplyHours: timedCount > 0 ? Math.round(Number(row?.avgHours ?? 0)) : null,
      }
    })
  },

  async getRecentReviews(organizationId, propertyId, limit) {
    return trace('review.servingStats.getRecentReviews', async () => {
      // F138: Replaced O(n) per-row EXISTS subqueries with a single LEFT JOIN.
      // COALESCE picks the most advanced reply status per review. A reply
      // Google shows (live observation head) is published whether or not
      // RepKey sent it, and outranks an open RepKey draft.
      //
      // `rating` and `reviewedAt` are the columns themselves. A raw
      // `sql<Date>` template is a type annotation with no decoder, and the
      // driver returns a timestamptz as text, so the dashboard was handed
      // "2026-09-12 11:30:00+03" typed as a Date.
      const rows = await deps.db
        .select({
          id: reviews.id,
          rating: reviews.rating,
          text: reviews.text,
          reviewedAt: reviews.reviewedAt,
          replyStatus: sql<string>`
            COALESCE(
              (SELECT CASE
                WHEN EXISTS (
                  SELECT 1 FROM replies
                  WHERE replies.review_id = reviews.id
                  AND replies.organization_id = ${organizationId}
                  AND replies.status = 'published'
                ) OR EXISTS (
                  SELECT 1 FROM google_reply_observation_heads
                  WHERE google_reply_observation_heads.review_id = reviews.id
                  AND google_reply_observation_heads.organization_id = ${organizationId}
                  AND google_reply_observation_heads.state = 'live'
                ) THEN 'published'
                WHEN EXISTS (
                  SELECT 1 FROM replies
                  WHERE replies.review_id = reviews.id
                  AND replies.organization_id = ${organizationId}
                  AND replies.status IN ('draft', 'pending_approval', 'approved')
                ) THEN 'draft'
                ELSE 'none'
              END),
              'none'
            )
          `.as('reply_status'),
        })
        .from(reviews)
        .where(servingRecentWhere(organizationId, propertyId, deps.clock()))
        .orderBy(desc(reviews.reviewedAt))
        .limit(limit)

      return rows.flatMap(servableRecentReview)
    })
  },
})
