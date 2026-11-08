import type { RatingKPIValue } from '../portal-results/contracts'
// Read-only aggregation surface. No domain rules, no events, no writes.

import { ok, err, type Result } from '#/shared/domain'
import type { InboxItemId, ReviewId } from '#/shared/domain/ids'

import type { GoogleNumbersView } from './google-numbers'
import type { RatingGoalMode, RatingGoalStatus } from './rating-goal'

// ─── KPI Strip ───

export type KPIValue = Readonly<{
  /** The Review-owned value for the current period. */
  value: number
  /** The Review-owned value for the prior period. */
  priorValue: number
  /** Percentage change vs prior period. Null when priorValue is 0. */
  trend: number | null
}>

export type MetricAvailabilityState =
  'ready' | 'updating' | 'insufficient_data' | 'temporarily_unavailable'

export type MetricKPIPeriodEvidence = Readonly<{
  state: MetricAvailabilityState
  definitionVersionId: string | null
  sampleCount: number
  minimumSample: number | null
}>

export type MetricKPIValue = Readonly<{
  /** Null unless the governed current-period source is available. */
  value: number | null
  /** Null unless the governed prior-period source is available. */
  priorValue: number | null
  /** Present only when both governed periods are available. */
  trend: number | null
  evidence: Readonly<{
    current: MetricKPIPeriodEvidence
    prior: MetricKPIPeriodEvidence | null
  }>
}>

export type KPIs = Readonly<{
  reviews: KPIValue
  avgRating: RatingKPIValue
  scans: MetricKPIValue
  feedback: MetricKPIValue
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
  /** % of reviews with a reply on Google, sent from RepKey or written there (0–100) */
  replyRate: number
  /**
   * Average hours from reviewedAt to the reply: when RepKey last confirmed
   * its reply on Google, else the time Google reports for the reply (its last
   * edit). Null when no replied review has a time, which can happen while
   * replyRate is above zero.
   */
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
  /**
   * The Inbox item that opens this review for the reader, so the row can link
   * to it. Reporting never reads Inbox tables: the Property overview fills it
   * in through the Inbox's own lookup (`getReviewInboxItemIds`), and it is null
   * where the reader has no item to open. Absent from every other read, which
   * links nothing.
   */
  inboxItemId?: InboxItemId | null
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

export type {
  PortalKPIs,
  PortalEngagementFunnel,
  PortalMetricEvidence,
  PortalPriorUnavailableReason,
  PortalCountKPIValue,
  RatingComparisonWithheld,
  RatingKPIValue,
  PortalResponseIntegritySummary,
  PortalRatingLanguages,
  PortalResultsThresholds,
  PortalAnalyticsData,
} from '../portal-results/contracts'

// ─── Attention Band ───

/** Compact signal counts shown in the property dashboard attention band. */
export type AttentionSignals = Readonly<{
  /** Open Google review handling cycles whose Response Target has passed. Inbox is the authority. */
  overdue: number
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
/**
 * The Properties list's "Google goal" cell, from the stored goal (cheap; the
 * live evaluation stays on the goal's own pages): an active goal's target,
 * mode and the status it last stored, or no goal and whether one is offered
 * (an active Property Google counts ten reviews for).
 */
export type FleetRatingGoal =
  | Readonly<{
      kind: 'set'
      mode: RatingGoalMode
      /** The target as Google prints it: 4.5. */
      target: number
      status: RatingGoalStatus | null
    }>
  | Readonly<{ kind: 'none'; offered: boolean }>

/** One property row in the cross-property fleet overview (2+ properties). */
export type FleetEntry = Readonly<{
  propertyId: string
  name: string
  slug: string
  timezone: string
  attentionSignals: Omit<AttentionSignals, 'ratingDrop'>
  /** Distinct attention work, never the sum of overlapping signal counts. */
  totalAttention: number
  /**
   * Google's own rating and count, the list's headline (decision 16); null when
   * Google never sent numbers for the current binding.
   */
  google: GoogleNumbersView | null
  /** Null when the reader's goal read (`goal.use`) is off. */
  ratingGoal: FleetRatingGoal | null
}>

/** Org-total summary shown in the fleet overview strip. */
export type FleetTotals = Readonly<{
  propertyCount: number
  totalAttention: number
}>

export type FleetOverviewData = Readonly<{
  entries: readonly FleetEntry[]
  totals: FleetTotals
  nextCursor: string | null
}>
