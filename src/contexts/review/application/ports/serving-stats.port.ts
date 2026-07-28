// Review context — ReviewServingStats port (BQC-5.5).
//
// The review-owned governed interface for AGGREGATE serving reads over
// review/reply content (the dashboard's review stats). Every read applies THE
// source-eligibility rule (ADR 0031: a successful-fetch clock exists and has
// not passed; clock-less rows fail closed) in SQL, with `now` injected by the
// composition clock — never DB now() (BQC-5.3). A reply of an expired review
// is not servable either (the review side of the join is eligibility-gated).
//
// Composition wires the review-infrastructure implementation into foreign
// consumers (dashboard); they depend on this type via application/public-api.

import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

/** Stats for a single period (count + average rating). */
export type ServingPeriodStats = Readonly<{
  count: number
  avgRating: number
}>

/** Star-rating bucket for distribution chart. */
export type ServingStarBucket = Readonly<{
  stars: number
  count: number
}>

/** Daily average-rating point for trend chart. */
export type ServingRatingTrendRow = Readonly<{
  date: string // YYYY-MM-DD
  avgRating: number
}>

/** Daily review-count point for volume chart. */
export type ServingVolumeRow = Readonly<{
  date: string // YYYY-MM-DD
  count: number
}>

/** Reply performance aggregates. */
export type ServingReplyPerformanceRow = Readonly<{
  totalReviews: number
  repliedCount: number
  avgReplyHours: number | null
}>

/** Recent review row with reply status. */
export type ServingRecentReviewRow = Readonly<{
  id: string
  rating: number
  text: string | null
  reviewedAt: Date
  replyStatus: string
}>

export type ReviewServingStats = Readonly<{
  /** Count + avg rating for a period (eligible content only). */
  getPeriodStats(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    startDate: Date,
    endDate: Date,
  ): Promise<ServingPeriodStats>

  /** Star-rating distribution for a period (eligible content only). */
  getRatingDistribution(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    startDate: Date,
    endDate: Date,
  ): Promise<readonly ServingStarBucket[]>

  /** Daily avg rating for a period (eligible content only). */
  getRatingTrend(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    startDate: Date,
    endDate: Date,
  ): Promise<readonly ServingRatingTrendRow[]>

  /** Daily review count for a period (eligible content only). */
  getReviewVolume(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    startDate: Date,
    endDate: Date,
  ): Promise<readonly ServingVolumeRow[]>

  /** Reply rate + avg hours for a period (eligible reviews only). */
  getReplyPerformance(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    startDate: Date,
    endDate: Date,
  ): Promise<ServingReplyPerformanceRow>

  /** Last N eligible reviews with reply status (no date filter). */
  getRecentReviews(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    limit: number,
  ): Promise<readonly ServingRecentReviewRow[]>
}>
