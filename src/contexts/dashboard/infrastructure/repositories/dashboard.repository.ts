// Dashboard context — Drizzle repository implementation
// Aggregation queries against reviews, replies, metric_readings.

import type { Database } from '#/shared/db'
import type { DashboardRepository } from '../../application/ports/dashboard.repository'
import type {
  KPIs,
  RatingDistribution,
  RatingTrendPoint,
  ReviewVolumePoint,
  ReplyPerformance,
  EngagementFunnel,
  RecentReview,
} from '../../domain/types'
import { toDashboardReplyStatus } from '../../domain/types'
import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'
import { reviews, replies, metricReadings } from '#/shared/db/schema'
import { and, count, avg, sum, eq, gte, lte, desc, sql } from 'drizzle-orm'

/** Common review WHERE clause: org + property + date range. */
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

/** Compute trend percentage. Returns null when prior is 0 or result is not finite. */
function trend(current: number, prior: number): number | null {
  if (prior === 0) return null
  const result = ((current - prior) / prior) * 100
  return Number.isFinite(result) ? Math.round(result) : null
}

const reviewDate = sql`DATE(${reviews.reviewedAt})`

export function createDashboardRepository(db: Database): DashboardRepository {
  return {
    async getRecentReviews(input): Promise<RecentReview[]> {
      const { organizationId, propertyId, limit = 5 } = input

      const rows = await db
        .select({
          id: reviews.id,
          rating: reviews.rating,
          text: reviews.text,
          reviewedAt: reviews.reviewedAt,
          replyStatus: sql<string>`
            CASE
              WHEN EXISTS (
                SELECT 1 FROM replies
                WHERE replies.review_id = reviews.id
                AND replies.status = ${'published'}
              ) THEN ${'published'}
              WHEN EXISTS (
                SELECT 1 FROM replies
                WHERE replies.review_id = reviews.id
                AND replies.status IN (${'draft'}, ${'pending_approval'}, ${'approved'})
              ) THEN ${'draft'}
              ELSE ${'none'}
            END
          `.as('reply_status'),
        })
        .from(reviews)
        // Intentionally no date filter — "recent reviews" always means last N overall,
        // not scoped to the dashboard's time range.
        .where(
          and(
            eq(reviews.organizationId, organizationId),
            eq(reviews.propertyId, propertyId),
          ),
        )
        .orderBy(desc(reviews.reviewedAt))
        .limit(limit)

      return rows.map((row) => ({
        id: row.id,
        rating: row.rating,
        snippet: row.text ?? '',
        reviewedAt: row.reviewedAt,
        replyStatus: toDashboardReplyStatus(row.replyStatus),
      }))
    },

    async getKPIs(input): Promise<KPIs> {
      const { organizationId, propertyId, startDate, endDate, priorStartDate, priorEndDate } = input

      // Reviews: count + avg rating for current and prior periods (parallel)
      const [currentReviews, priorReviews] = await Promise.all([
        db
          .select({ count: count(), avgRating: avg(reviews.rating) })
          .from(reviews)
          .where(reviewWhere(organizationId, propertyId, startDate, endDate)),
        db
          .select({ count: count(), avgRating: avg(reviews.rating) })
          .from(reviews)
          .where(reviewWhere(organizationId, propertyId, priorStartDate, priorEndDate)),
      ])

      const curReviewCount = Number(currentReviews[0]?.count ?? 0)
      const priorReviewCount = Number(priorReviews[0]?.count ?? 0)
      const curAvgRating = Number(currentReviews[0]?.avgRating ?? 0)
      const priorAvgRating = Number(priorReviews[0]?.avgRating ?? 0)

      // Metric readings: scans + feedback for current and prior (parallel)
      const metricConditions = (start: Date, end: Date) =>
        and(
          eq(metricReadings.organizationId, organizationId),
          eq(metricReadings.propertyId, propertyId),
          gte(metricReadings.recordedAt, start),
          lte(metricReadings.recordedAt, end),
        )

      const [currentMetrics, priorMetrics] = await Promise.all([
        db
          .select({
            metricKey: metricReadings.metricKey,
            total: sum(metricReadings.value),
          })
          .from(metricReadings)
          .where(metricConditions(startDate, endDate))
          .groupBy(metricReadings.metricKey),
        db
          .select({
            metricKey: metricReadings.metricKey,
            total: sum(metricReadings.value),
          })
          .from(metricReadings)
          .where(metricConditions(priorStartDate, priorEndDate))
          .groupBy(metricReadings.metricKey),
      ])

      const toMap = (rows: { metricKey: string; total: string | null }[]) =>
        new Map(rows.map((r) => [r.metricKey, Number(r.total ?? 0)]))

      const curMetrics = toMap(currentMetrics)
      const priorMetricsMap = toMap(priorMetrics)

      const curScans = curMetrics.get('portal.scan') ?? 0
      const priorScans = priorMetricsMap.get('portal.scan') ?? 0
      const curFeedback = curMetrics.get('portal.feedback') ?? 0
      const priorFeedback = priorMetricsMap.get('portal.feedback') ?? 0

      return {
        reviews: { value: curReviewCount, priorValue: priorReviewCount, trend: trend(curReviewCount, priorReviewCount) },
        avgRating: { value: curAvgRating, priorValue: priorAvgRating, trend: trend(curAvgRating, priorAvgRating) },
        scans: { value: curScans, priorValue: priorScans, trend: trend(curScans, priorScans) },
        feedback: { value: curFeedback, priorValue: priorFeedback, trend: trend(curFeedback, priorFeedback) },
      }
    },
    async getRatingDistribution(input): Promise<RatingDistribution> {
      const { organizationId, propertyId, startDate, endDate } = input

      const rows = await db
        .select({ stars: reviews.rating, count: count() })
        .from(reviews)
        .where(reviewWhere(organizationId, propertyId, startDate, endDate))
        .groupBy(reviews.rating)

      // Build all 5 buckets, filling 0 for missing stars
      const bucketMap = new Map(rows.map((r) => [r.stars, r.count]))
      return [1, 2, 3, 4, 5].map((stars) => ({
        stars,
        count: bucketMap.get(stars) ?? 0,
      }))
    },
    async getRatingTrend(input): Promise<RatingTrendPoint[]> {
      const { organizationId, propertyId, startDate, endDate } = input

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
    },
    async getReviewVolume(input): Promise<ReviewVolumePoint[]> {
      const { organizationId, propertyId, startDate, endDate } = input

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
    },
    async getReplyPerformance(input): Promise<ReplyPerformance> {
      const { organizationId, propertyId, startDate, endDate } = input

      const [reviewCountRow, replyAgg] = await Promise.all([
        db
          .select({ count: count() })
          .from(reviews)
          .where(reviewWhere(organizationId, propertyId, startDate, endDate)),
        db
          .select({
            repliedCount: count(),
            avgHours: avg(sql<number>`EXTRACT(EPOCH FROM (replies.published_at - reviews.reviewed_at)) / 3600`),
          })
          .from(replies)
          .innerJoin(reviews, eq(replies.reviewId, reviews.id))
          .where(
            and(
              eq(replies.organizationId, organizationId),
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
      const replyRate = totalReviews > 0 ? (repliedCount / totalReviews) * 100 : 0
      const avgReplyHours = repliedCount > 0 ? Math.round(Number(replyAgg[0]?.avgHours ?? 0)) : null

      return { replyRate: Math.round(replyRate * 100) / 100, avgReplyHours }
    },
    async getEngagementFunnel(input): Promise<EngagementFunnel> {
      const { organizationId, propertyId, portalId, startDate, endDate } = input

      const rows = await db
        .select({
          metricKey: metricReadings.metricKey,
          total: sum(metricReadings.value),
        })
        .from(metricReadings)
        .where(
          and(
            eq(metricReadings.organizationId, organizationId),
            eq(metricReadings.propertyId, propertyId),
            eq(metricReadings.portalId, portalId),
            gte(metricReadings.recordedAt, startDate),
            lte(metricReadings.recordedAt, endDate),
          ),
        )
        .groupBy(metricReadings.metricKey)

      const metricMap = new Map(rows.map((r) => [r.metricKey, Number(r.total ?? 0)]))

      return {
        scans: metricMap.get('portal.scan') ?? 0,
        ratings: metricMap.get('portal.feedback') ?? 0,
        reviewLinkClicks: metricMap.get('portal.review_link_click') ?? 0,
      }
    },
  }
}
