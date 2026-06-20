// Dashboard context — Drizzle adapter implementing ReviewStatsPort
// SQL queries against reviews + replies tables.
// This is the ONLY place dashboard infrastructure touches review/reply tables.

import type { Database } from '#/shared/db'
import { reviews, replies } from '#/shared/db/schema'
import { and, count, avg, eq, gte, lte, desc, sql } from 'drizzle-orm'
import { trace } from '#/shared/observability/trace'
import type { ReviewStatsPort } from '../../application/ports/review-stats.port'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

// F055 NOTE: reviews table has no deletedAt column — soft-delete filtering is not needed here.
// If a soft-delete column is added in the future, add a `ne(reviews.deletedAt, null)` filter.
function reviewWhere(
  organizationId: OrganizationId,
  propertyId: PropertyId,
  startDate: Date,
  endDate: Date,
) {
  return and(
    eq(reviews.organizationId, organizationId),
    eq(reviews.propertyId, propertyId),
    gte(reviews.reviewedAt, startDate),
    lte(reviews.reviewedAt, endDate),
  )
}

const reviewDate = sql`DATE(${reviews.reviewedAt})`

export const createReviewStatsAdapter = (db: Database): ReviewStatsPort => ({
  async getPeriodStats(organizationId, propertyId, startDate, endDate) {
    return trace('dashboard.reviewStats.getPeriodStats', async () => {
      const rows = await db
        .select({ count: count(), avgRating: avg(reviews.rating) })
        .from(reviews)
        .where(reviewWhere(organizationId, propertyId, startDate, endDate))

      return {
        // F132: Defensive null fallback — avgRating is null when no reviews exist
        count: Number(rows[0]?.count ?? 0),
        avgRating: rows[0]?.avgRating != null ? Number(rows[0].avgRating) : 0,
      }
    })
  },

  async getRatingDistribution(organizationId, propertyId, startDate, endDate) {
    return trace('dashboard.reviewStats.getRatingDistribution', async () => {
      const rows = await db
        .select({ stars: reviews.rating, count: count() })
        .from(reviews)
        .where(reviewWhere(organizationId, propertyId, startDate, endDate))
        .groupBy(reviews.rating)

      const bucketMap = new Map(rows.map((r) => [r.stars, r.count]))
      return [1, 2, 3, 4, 5].map((stars) => ({
        stars,
        count: bucketMap.get(stars) ?? 0,
      }))
    })
  },

  async getRatingTrend(organizationId, propertyId, startDate, endDate) {
    return trace('dashboard.reviewStats.getRatingTrend', async () => {
      const rows = await db
        .select({
          date: sql<string>`TO_CHAR(${reviewDate}, 'YYYY-MM-DD')`.as('date'),
          avgRating: avg(reviews.rating),
        })
        .from(reviews)
        .where(reviewWhere(organizationId, propertyId, startDate, endDate))
        .groupBy(reviewDate)
        .orderBy(reviewDate)

      return rows.map((r) => ({
        date: r.date,
        avgRating: Math.round(Number(r.avgRating) * 100) / 100,
      }))
    })
  },

  async getReviewVolume(organizationId, propertyId, startDate, endDate) {
    return trace('dashboard.reviewStats.getReviewVolume', async () => {
      const rows = await db
        .select({
          date: sql<string>`TO_CHAR(${reviewDate}, 'YYYY-MM-DD')`.as('date'),
          count: count(),
        })
        .from(reviews)
        .where(reviewWhere(organizationId, propertyId, startDate, endDate))
        .groupBy(reviewDate)
        .orderBy(reviewDate)

      return rows.map((r) => ({
        date: r.date,
        count: Number(r.count),
      }))
    })
  },

  async getReplyPerformance(organizationId, propertyId, startDate, endDate) {
    return trace('dashboard.reviewStats.getReplyPerformance', async () => {
      const [reviewCountRow, replyAgg] = await Promise.all([
        db
          .select({ count: count() })
          .from(reviews)
          .where(reviewWhere(organizationId, propertyId, startDate, endDate)),
        db
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
              lte(reviews.reviewedAt, endDate),
              sql`replies.published_at IS NOT NULL`,
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
    return trace('dashboard.reviewStats.getRecentReviews', async () => {
      // F138: Replaced O(n) per-row EXISTS subqueries with a single LEFT JOIN.
      // COALESCE picks the most advanced reply status per review.
      const rows = await db
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
        .where(
          and(
            eq(reviews.organizationId, organizationId),
            eq(reviews.propertyId, propertyId),
          ),
        )
        .orderBy(desc(reviews.reviewedAt))
        .limit(limit)

      return rows
    })
  },
})
