// Dashboard context — domain response shapes
// Read-only aggregation surface. No domain rules, no events, no writes.

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
  date: string // YYYY-MM-DD or YYYY-WNN for weekly
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
export function toDashboardReplyStatus(value: string): DashboardReplyStatus {
  if (!DASHBOARD_REPLY_STATUSES.has(value)) {
    throw new Error(`Invalid DashboardReplyStatus: "${value}"`)
  }
  return value as DashboardReplyStatus
}

export type RecentReview = Readonly<{
  id: string
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
