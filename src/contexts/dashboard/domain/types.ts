// Dashboard context — domain response shapes
// Read-only aggregation surface. No domain rules, no events, no writes.

import { ok, err, type Result } from '#/shared/domain'
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
  scans: PortalCountKPIValue
  avgRating: PortalRatingKPIValue
  feedback: PortalCountKPIValue
  reviewLinkClicks: PortalCountKPIValue
}>

export type PortalMetricDataState =
  'ready' | 'updating' | 'insufficient_data' | 'temporarily_unavailable'

export type PortalMetricEvidence = Readonly<{
  definitionVersionId: string
  state: PortalMetricDataState
  verifiedThrough: Date | null
  latestActivity: Date | null
  computedAt: Date
  completeness: number
  availabilityReason: string | null
  correctionHead: Date | null
  sampleCount: number
}>

export type PortalCountKPIValue = Readonly<{
  /** Null while the governed projection is not safe to serve. */
  value: number | null
  priorValue: number | null
  trend: number | null
  evidence: PortalMetricEvidence
}>

export type PortalRatingKPIValue = Readonly<{
  /** Eligible private-rating average. Null means there is no eligible sample. */
  value: number | null
  priorValue: number | null
  /** Absolute star difference; shown only when both bounded periods have 10+ ratings. */
  comparison: number | null
  sampleCount: number
  priorSampleCount: number
  evidence: PortalMetricEvidence
}>

export type PortalResponseIntegritySummary = Readonly<{
  accepted: number
  filteredAutomatically: number
  underReview: number
  total: number
}>

export type PortalAnalyticsData = Readonly<{
  period: Readonly<{ startAt: Date; endAt: Date; timezone: string }>
  kpis: PortalKPIs
  engagementFunnel: EngagementFunnel | null
  ratingDistribution: RatingDistribution
  ratingTrend: PortalRatingTrendPoint[]
  responseIntegrity: PortalResponseIntegritySummary
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
  /** Current open Inbox work across Review and Private Feedback sources. */
  itemsToTriage: number
  /** Active goals whose progress is behind the pro-rated pace. */
  goalsBehindPace: number
  /** Avg rating dropped ≥ 0.3 vs prior period. */
  ratingDrop: boolean
  /** Inbox items with an active escalation, whether open or closed. */
  escalated: number
  /** Distinct work anchors, plus one when the rating-drop signal is active. */
  needsAttention: number
}>

// ─── Fleet Overview ───
export type FleetMetricFreshness = 'fresh' | 'stale' | 'insufficient_data'

/** Provenance exposed with every governed fleet KPI. */
export type FleetMetricEvidence = Readonly<{
  definitionVersionId: string
  periodStart: Date
  periodEnd: Date
  timezone: string
  sourcePolicies: readonly string[]
  watermark: Date | null
  freshness: FleetMetricFreshness
  /** Eligible exact readings divided by all governed readings for the period. */
  completeness: number
  correctionCount: number
}>

/** One property row in the cross-property fleet overview (2+ properties). */
export type FleetEntry = Readonly<{
  propertyId: string
  name: string
  slug: string
  timezone: string
  avgRating: number
  /** Absolute star delta vs prior period. Null when either sample is insufficient. */
  avgRatingComparison: number | null
  reviewCount: number
  feedbackCount: number
  scanCount: number
  reviewEvidence: FleetMetricEvidence
  /** Null means Portal policy excluded the optional overlay for this property. */
  scanEvidence: FleetMetricEvidence | null
  feedbackEvidence: FleetMetricEvidence | null
  attentionSignals: AttentionSignals
  /** Distinct attention work, never the sum of overlapping signal counts. */
  totalAttention: number
}>

/** Org-total summary shown in the fleet overview strip. */
export type FleetTotals = Readonly<{
  propertyCount: number
  /** Eligible reviews contributing to the rating-weighted fleet average. */
  ratingSampleCount: number
  totalAttention: number
  /** Review-count-weighted mean across eligible property ratings. */
  overallAvgRating: number
}>

export type FleetOverviewData = Readonly<{
  entries: readonly FleetEntry[]
  totals: FleetTotals
  nextCursor: string | null
}>
