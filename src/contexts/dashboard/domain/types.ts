// Dashboard context — domain response shapes
// Read-only aggregation surface. No domain rules, no events, no writes.

// ─── KPI Strip ───

export interface KPIValue {
  /** The metric value for the current period. 0 when no data exists. */
  value: number
  /** The metric value for the prior period. 0 when no data exists. */
  priorValue: number
  /** Percentage change vs prior period. Null when priorValue is 0. */
  trend: number | null
}

export interface KPIs {
  reviews: KPIValue
  avgRating: KPIValue
  scans: KPIValue
  feedback: KPIValue
}

// ─── Rating Distribution ───

export interface RatingBucket {
  stars: number
  count: number
}

export type RatingDistribution = RatingBucket[]

// ─── Charts ───

export interface RatingTrendPoint {
  date: string // YYYY-MM-DD
  avgRating: number
}

export interface ReviewVolumePoint {
  date: string // YYYY-MM-DD or YYYY-WNN for weekly
  count: number
}

// ─── Reply Performance ───

export interface ReplyPerformance {
  /** % of reviews with a published reply (0–100) */
  replyRate: number
  /** Average hours from reviewedAt to publishedAt. Null when no replies. */
  avgReplyHours: number | null
}

// ─── Engagement Funnel ───

export interface EngagementFunnel {
  scans: number
  ratings: number
  reviewLinkClicks: number
}

// ─── Recent Reviews ───

/**
 * Simplified reply status for the dashboard.
 * Maps DB reply_status_enum values:
 *   - 'published' → 'published'
 *   - 'draft' | 'pending_approval' | 'approved' → 'draft' (in-progress)
 *   - no reply exists → 'none'
 * Note: 'rejected' and 'publish_failed' are treated as 'none' (no active reply).
 */
export type ReplyStatus = 'none' | 'draft' | 'published'

export interface RecentReview {
  id: string
  rating: number
  snippet: string
  reviewedAt: Date
  replyStatus: ReplyStatus
}

// ─── Full Dashboard Response ───

export interface DashboardData {
  kpis: KPIs
  ratingDistribution: RatingDistribution
  ratingTrend: RatingTrendPoint[]
  reviewVolume: ReviewVolumePoint[]
  replyPerformance: ReplyPerformance
  engagementFunnel: EngagementFunnel | null
  recentReviews: RecentReview[]
}
