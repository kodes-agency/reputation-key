// Dashboard context — domain response shapes
// Read-only aggregation surface. No domain rules, no events, no writes.

import { ok, err, type Result } from 'neverthrow'
import type { ReviewId } from '#/shared/domain/ids'

export type PortalRatingTrendPoint = Readonly<{
  date: string // YYYY-MM-DD
  avgRating: number
}>

// ─── KPI Strip ───

export type KPIValue = Readonly<{
  /** The metric value for the current period. 0 when no data exists. */
  value: number
  /** The metric value for the prior period. 0 when no data exists. */
  priorValue: number
  /** Percentage change vs prior period. Null when priorValue is 0. */
  trend: number | null
}>

export type KPIs = Readonly<{
  reviews: KPIValue
  avgRating: KPIValue
  scans: KPIValue
  feedback: KPIValue
}>

// ─── Rating Distribution ───

export type RatingBucket = Readonly<{
  stars: number
  count: number
}>

export type RatingDistribution = readonly RatingBucket[]

// ─── Charts ───

export type RatingTrendPoint = Readonly<{
  date: string // YYYY-MM-DD
  avgRating: number
}>

export type ReviewVolumePoint = Readonly<{
  date: string // YYYY-MM-DD
  count: number
}>

// ─── Reply Performance ───

export type ReplyPerformance = Readonly<{
  /** % of reviews with a published reply (0–100) */
  replyRate: number
  /** Average hours from reviewedAt to publishedAt. Null when no replies. */
  avgReplyHours: number | null
}>

// ─── Engagement Funnel ───

export type EngagementFunnel = Readonly<{
  scans: number
  ratings: number
  reviewLinkClicks: number
}>

// ─── Recent Reviews ───

/**
 * Simplified reply status for the dashboard.
 * Maps DB reply_status_enum values:
 *   - 'published' → 'published'
 *   - 'draft' | 'pending_approval' | 'approved' → 'draft' (in-progress)
 *   - 'rejected' | 'publish_failed' | no reply → 'none'
 * SQL CASE uses ELSE 'none' catch-all — new enum variants will map here until explicitly handled.
 */
export type DashboardReplyStatus = 'none' | 'draft' | 'published'

const DASHBOARD_REPLY_STATUSES = new Set<string>(['none', 'draft', 'published'])

/** Validate that a SQL CASE result is a valid DashboardReplyStatus. */
export function toDashboardReplyStatus(
  value: string,
): Result<DashboardReplyStatus, string> {
  if (!DASHBOARD_REPLY_STATUSES.has(value)) {
    return err(`Invalid DashboardReplyStatus: "${value}"`)
  }
  return ok(value as DashboardReplyStatus)
}

export type RecentReview = Readonly<{
  id: ReviewId
  rating: number
  snippet: string
  reviewedAt: Date
  replyStatus: DashboardReplyStatus
}>

// ─── Full Dashboard Response ───

export type DashboardData = Readonly<{
  kpis: KPIs
  ratingDistribution: RatingDistribution
  ratingTrend: RatingTrendPoint[]
  reviewVolume: ReviewVolumePoint[]
  replyPerformance: ReplyPerformance
  engagementFunnel: EngagementFunnel | null
  recentReviews: RecentReview[]
}>

// ─── Portal Analytics ───

export type PortalKPIs = Readonly<{
  scans: KPIValue
  avgRating: KPIValue
  feedback: KPIValue
  reviewLinkClicks: KPIValue
}>

export type PortalAnalyticsData = Readonly<{
  kpis: PortalKPIs
  engagementFunnel: EngagementFunnel
  ratingDistribution: RatingDistribution
  ratingTrend: PortalRatingTrendPoint[]
}>

// ─── Staff Dashboard ───

export type StaffDashboardData = Readonly<{
  kpis: KPIs
  hasAssignments: boolean
}>

// ─── Attention Band ───

/** Compact signal counts shown in the property dashboard attention band. */
export type AttentionSignals = Readonly<{
  /** Reviews with no published reply past the response SLA. */
  unanswered: number
  /** Inbox items in 'new' status (unactioned feedback). */
  newFeedback: number
  /** Active goals whose progress is behind the pro-rated pace. */
  goalsBehindPace: number
  /** Avg rating dropped ≥ 0.3 vs prior period. */
  ratingDrop: boolean
  /** Inbox items in 'escalated' status. */
  escalated: number
}>

// ─── Fleet Overview ───

/** One property row in the cross-property fleet overview (2+ properties). */
export type FleetEntry = Readonly<{
  propertyId: string
  name: string
  slug: string
  timezone: string
  avgRating: number
  /** Percentage change in avg rating vs prior period. Null when no prior data. */
  avgRatingTrend: number | null
  reviewCount: number
  feedbackCount: number
  scanCount: number
  attentionSignals: AttentionSignals
  /** Sum of all attention signals (ratingDrop counts as 1 when true). */
  totalAttention: number
}>

/** Org-total summary shown in the fleet overview strip. */
export type FleetTotals = Readonly<{
  propertyCount: number
  totalAttention: number
  /** Mean of per-property avg ratings (properties with 0 rating excluded). */
  overallAvgRating: number
}>

export type FleetOverviewData = Readonly<{
  entries: readonly FleetEntry[]
  totals: FleetTotals
}>
