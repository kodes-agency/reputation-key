// Review context — ReviewServingStats implementation (BQC-5.5).
//
// Review-owned governed aggregate serving reads over reviews + replies. The
// SQL moved here from the dashboard review-stats adapter, with ONE behavior
// change (the point of the move): EVERY review-content read now applies THE
// source-eligibility predicate — `contentExpiresAt IS NOT NULL AND
// contentExpiresAt > now` with `now` INJECTED from the composition clock
// (BQC-5.3 — never DB now()). This mirrors isContentEligibleForRead
// (application/source-content-lifecycle, ADR 0031): clock-less rows fail
// closed. The replies join applies the same eligibility on the review side —
// a reply of an expired review is not servable.
//
// F055 NOTE: reviews table has no deletedAt column — soft-delete filtering is
// not needed here. If a soft-delete column is added, filter it in the
// where-builders below (one place per query family).

import type { Database } from '#/shared/db'
import { reviews, replies } from '#/shared/db/schema'
import { and, count, avg, eq, gte, gt, lt, desc, isNotNull, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { trace } from '#/shared/observability/trace'
import type { Clock } from '#/shared/domain/clock'
import type { ReviewServingStats } from '../application/ports/serving-stats.port'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

/**
 * THE serving-eligibility predicate (ADR 0031). Kept next to the queries so
 * every serving read composes it; the dashboard's own attention-signals copy
 * is pinned equivalent by an integration test over a shared fixture set.
 */
const contentEligible = (now: Date) =>
  and(isNotNull(reviews.contentExpiresAt), gt(reviews.contentExpiresAt, now))

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

const reviewDate = sql`DATE(${reviews.reviewedAt})`

type DailySeriesRow = Readonly<{ date: string; value: number | null }>

/**
 * THE daily-series skeleton over the serving scope: one row per reviewedAt
 * day, ordered chronologically. `aggregate` picks the per-day value —
 * avgRating (trend) or count (volume); consumers round/project.
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
    .where(where)
    .groupBy(reviewDate)
    .orderBy(reviewDate)
  return rows.map((r) => ({
    date: r.date,
    value: r.value != null ? Number(r.value) : null,
  }))
}

export const createServingStats = (deps: {
  db: Database
  clock: Clock
}): ReviewServingStats => ({
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
        // F132: Defensive null fallback — avgRating is null when no reviews exist
        count: Number(rows[0]?.count ?? 0),
        avgRating: rows[0]?.avgRating != null ? Number(rows[0].avgRating) : 0,
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

  async getReplyPerformance(organizationId, propertyId, startDate, endDate) {
    return trace('review.servingStats.getReplyPerformance', async () => {
      const now = deps.clock()
      const [reviewCountRow, replyAgg] = await Promise.all([
        deps.db
          .select({ count: count() })
          .from(reviews)
          .where(servingPeriodWhere(organizationId, propertyId, startDate, endDate, now)),
        deps.db
          .select({
            repliedCount: count(),
            avgHours: avg(
              sql<number>`EXTRACT(EPOCH FROM (replies.published_at - reviews.reviewed_at)) / 3600`,
            ),
          })
          .from(replies)
          .innerJoin(reviews, eq(replies.reviewId, reviews.id))
          .where(
            and(
              eq(replies.organizationId, organizationId),
              // F131: Add orgId filter on reviews table for tenant isolation
              eq(reviews.organizationId, organizationId),
              eq(reviews.propertyId, propertyId),
              eq(replies.status, 'published'),
              gte(reviews.reviewedAt, startDate),
              lt(reviews.reviewedAt, endDate),
              sql`replies.published_at IS NOT NULL`,
              // BQC-5.5: a reply of an expired review is not servable.
              contentEligible(now),
            ),
          ),
      ])

      const totalReviews = Number(reviewCountRow[0]?.count ?? 0)
      const repliedCount = Number(replyAgg[0]?.repliedCount ?? 0)
      const avgReplyHours =
        repliedCount > 0 ? Math.round(Number(replyAgg[0]?.avgHours ?? 0)) : null

      return { totalReviews, repliedCount, avgReplyHours }
    })
  },

  async getRecentReviews(organizationId, propertyId, limit) {
    return trace('review.servingStats.getRecentReviews', async () => {
      // F138: Replaced O(n) per-row EXISTS subqueries with a single LEFT JOIN.
      // COALESCE picks the most advanced reply status per review.
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

      return rows
    })
  },
})
