// Dashboard context — ReviewStatsPort (facade port per ADR-0007)
// Aggregation queries against review/reply data.
// Dashboard never imports review/reply tables directly — this port is the boundary.

import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

/** Stats for a single period (count + average rating). */
export type ReviewPeriodStats = Readonly<{
  count: number
  avgRating: number
}>

/** Star-rating bucket for distribution chart. */
export type StarBucket = Readonly<{
  stars: number
  count: number
}>

/** Daily average-rating point for trend chart. */
export type RatingTrendRow = Readonly<{
  date: string // YYYY-MM-DD
  avgRating: number
}>

/** Daily review-count point for volume chart. */
export type VolumeRow = Readonly<{
  date: string // YYYY-MM-DD
  count: number
}>

/** Reply performance aggregates. */
export type ReplyPerformanceRow = Readonly<{
  totalReviews: number
  repliedCount: number
  avgReplyHours: number | null
}>

/** Recent review row with reply status. */
export type RecentReviewRow = Readonly<{
  id: string
  rating: number
  text: string | null
  reviewedAt: Date
  replyStatus: string
}>

export type ReviewStatsPort = Readonly<{
  /** Count + avg rating for a period. */
  getPeriodStats(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    startDate: Date,
    endDate: Date,
  ): Promise<ReviewPeriodStats>

  /** Star-rating distribution for a period. */
  getRatingDistribution(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    startDate: Date,
    endDate: Date,
  ): Promise<readonly StarBucket[]>

  /** Daily avg rating for a period. */
  getRatingTrend(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    startDate: Date,
    endDate: Date,
  ): Promise<readonly RatingTrendRow[]>

  /** Daily review count for a period. */
  getReviewVolume(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    startDate: Date,
    endDate: Date,
  ): Promise<readonly VolumeRow[]>

  /** Reply rate + avg hours for a period. */
  getReplyPerformance(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    startDate: Date,
    endDate: Date,
  ): Promise<ReplyPerformanceRow>

  /** Last N reviews with reply status (no date filter). */
  getRecentReviews(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    limit: number,
  ): Promise<readonly RecentReviewRow[]>
}>
