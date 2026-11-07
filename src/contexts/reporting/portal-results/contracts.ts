import { z } from 'zod/v4'
import type {
  MetricAvailabilityState,
  RatingDistribution,
} from '../domain/dashboard-types'
import type { PortalLinkTaps } from '../domain/portal-link-taps'
import type { PortalScanPatterns } from '../domain/portal-scan-patterns'
import type {
  PortalResultsSeries,
  PortalVersionMarker,
} from '../domain/portal-results-series'

export type { PortalLinkTaps } from '../domain/portal-link-taps'
export { PORTAL_LINK_TAPS_COUNTED_SINCE } from '../domain/portal-link-taps'
export type {
  PortalResultsSeries,
  PortalVersionMarker,
  PortalSeriesBucket,
} from '../domain/portal-results-series'

export const timeRangePreset = z.enum(['7d', '30d', '60d', '90d', '180d', 'all'])
export type TimeRangePreset = z.infer<typeof timeRangePreset>

/** A window preset the overview can read; All Time is a lifetime figure, not a window. */
export type PortalResultsTimeRange =
  Exclude<TimeRangePreset, 'all'> | 'today' | 'week' | 'month' | 'last-month'

// Organization scope comes from the authenticated session.
export const getPortalAnalyticsDto = z.object({
  propertyId: z.uuid(),
  portalId: z.uuid(),
  timeRange: timeRangePreset.default('30d'),
  compare: z.boolean().default(true),
})

// ─── Portal Analytics ───

/**
 * The Portal results measures, each named for what it counts.
 *
 * - `scans` are QUALIFIED scans (server-verified, deduplicated per session),
 *   counted from the day qualified scans began, not raw page opens.
 * - `ratings` is the number of eligible private ratings.
 * - `avgRating` is withheld (value null, evidence `insufficient_data`) below
 *   the average sample floor; `sampleCount` is always the true n.
 * - `googleOpens` counts guests who opened the Google review link. Secondary
 *   links are not Google opens.
 * - `feedback` is private notes.
 * Every count carries `priorValue`, the absolute figure for the prior window.
 */
export type PortalKPIs = Readonly<{
  scans: PortalCountKPIValue
  ratings: PortalCountKPIValue
  avgRating: RatingKPIValue
  feedback: PortalCountKPIValue
  googleOpens: PortalCountKPIValue
}>

/** Qualified scans -> private ratings -> Google opens. */
export type PortalEngagementFunnel = Readonly<{
  qualifiedScans: number
  ratings: number
  googleOpens: number
}>

export type PortalMetricEvidence = Readonly<{
  /** Omitted means a bounded governed period; lifetime has no time series. */
  basis?: 'governed_period' | 'anonymous_lifetime'
  definitionVersionId: string | null
  state: MetricAvailabilityState
  verifiedThrough: Date | null
  latestActivity: Date | null
  computedAt: Date
  completeness: number
  availabilityReason: string | null
  correctionHead: Date | null
  sampleCount: number
}>

export type PortalLifetimeReconciliationState = Readonly<{
  state: 'not_initialized' | 'awaiting_first_reconciliation' | 'reconciled'
  projectionRevision: number | null
  sealedThroughLocalDate: string | null
  lastRebuiltAt: Date | null
  lastSealedAt: Date | null
}>

/** Why a count has no prior figure although the measure has a prior window. */
export type PortalPriorUnavailableReason = 'measure_not_yet_counted'

export type PortalCountKPIValue = Readonly<{
  /** Null while the governed projection is not safe to serve. */
  value: number | null
  priorValue: number | null
  /**
   * Set when the prior window opens before the measure was counted at all
   * (qualified scans), so a prior figure would be a false zero.
   */
  priorUnavailableReason?: PortalPriorUnavailableReason
  trend: number | null
  evidence: PortalMetricEvidence
}>

/** Why a rating comparison is not shown, so the client never guesses. */
export type RatingComparisonWithheld = 'sample_too_small' | 'evidence_not_ready'

export type RatingKPIValue = Readonly<{
  /** Eligible rating average. Null means there is no eligible sample. */
  value: number | null
  priorValue: number | null
  /** Absolute star difference; shown only when both bounded periods clear the comparison floor. */
  comparison: number | null
  /**
   * Set on Portal period reads when `comparison` is null: the sample floor and
   * an evidence that is not ready are different situations and read differently.
   */
  comparisonWithheld?: RatingComparisonWithheld | null
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

/**
 * Private ratings by the language of the page the guest saw. `total` counts
 * every rating read, those with no recorded language (`unrecorded`) included.
 */
export type PortalRatingLanguages = Readonly<{
  total: number
  languages: ReadonlyArray<Readonly<{ locale: string; count: number }>>
  unrecorded: number
}>

/** The sample floors the server applied, so a client never keeps a copy. */
export type PortalResultsThresholds = Readonly<{
  busiestMinScans: number
  /** Private ratings a period needs before its average is shown. */
  averageMinSample: number
  /** Private ratings each period needs before two averages are compared. */
  comparisonMinSample: number
}>

export type PortalAnalyticsData = Readonly<{
  period: Readonly<{ startAt: Date; endAt: Date; timezone: string }>
  /** The equal-length window before, when compared; null for All Time or "off". */
  comparePeriod: Readonly<{ startAt: Date; endAt: Date }> | null
  /**
   * The window and its comparison as Property-local calendar days (`YYYY-MM-DD`,
   * both ends inclusive), for labels like "1-30 Sep" that a client must not
   * work out from instants and a zone. Null for All Time.
   */
  localDays: Readonly<{
    start: string
    end: string
    compareStart: string | null
    compareEnd: string | null
  }> | null
  /** The first day qualified scans were counted, from the metric registry. */
  qualifiedScansSince: Date
  /** Present only for the anonymous, non-comparative All Time projection. */
  lifetimeReconciliation: PortalLifetimeReconciliationState | null
  kpis: PortalKPIs
  engagementFunnel: PortalEngagementFunnel | null
  ratingDistribution: RatingDistribution
  /** Weekly qualified scans and average, anchored to the window start. Null for All Time. */
  series: PortalResultsSeries | null
  /** Versions that went live inside the window; empty for All Time. */
  versionMarkers: readonly PortalVersionMarker[]
  linkTaps: PortalLinkTaps | null
  scanPatterns: PortalScanPatterns | null
  ratingLanguages: PortalRatingLanguages
  thresholds: PortalResultsThresholds
  responseIntegrity: PortalResponseIntegritySummary
}>
