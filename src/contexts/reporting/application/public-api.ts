import type { Tx } from '#/shared/outbox/commit'
import type { PortalRatingGoalBlock } from './running-portal-rating-goal'
// Reporting context — the single cross-context interface for metrics, goals,
// and dashboard reads. Implementation modules inside this context import one
// another directly through the normal layer rules rather than through this file.

import type { GoalMetricCorrectionImpactLookup } from './ports/goal-metric-correction-impact.lookup'
import type { CurrentGoogleReputationSnapshotStore } from './ports/current-google-reputation-snapshot.port'
import type { PortalAnalyticsRepository } from './ports/portal-analytics.repository'
import type {
  GovernedGoalMetricQuery,
  GovernedGoalMetricResult,
} from './use-cases/query-goal-metric'
import type { GovernedMetricVersion } from '../readings/contracts'

// Metric contracts.
export type { GovernedGoalMetricQuery, GovernedGoalMetricResult }
export type {
  MetricPortalMetricEvidence,
  MetricPortalMetricEvidenceSet,
  PortalMetricSumRow,
  PortalRatingBucket,
} from './ports/portal-analytics.repository'
export type { MetricRecorded, MetricEvent } from '../domain/metric-events'
export {
  METRIC_DEFINITION_IDS,
  METRIC_VERSION_IDS,
  findMetricVersionById,
} from '../readings/contracts'
export type {
  GovernedMetricVersion,
  SeededMetricRegistryEntry,
} from '../readings/contracts'

export type {
  FindGoalMetricCorrectionImpactsInput,
  GoalMetricCorrectionImpact,
} from './ports/goal-metric-correction-impact.lookup'

export type MetricPublicApi = Readonly<{
  queryGoalMetric: (query: GovernedGoalMetricQuery) => Promise<GovernedGoalMetricResult>
  portalAnalytics: PortalAnalyticsRepository
  getCurrentOnGoogle: CurrentGoogleReputationSnapshotStore['getCurrentOnGoogle']
  findGoalMetricCorrectionImpacts: GoalMetricCorrectionImpactLookup['findGoalMetricCorrectionImpacts']
  getApprovedGoalVersion?: (
    definitionVersionId: string,
  ) => Promise<GovernedMetricVersion | null>
}>

// Goal contracts.
export type PortalRatingGoalReadApi = Readonly<{
  /** Caller holds the shared Property goal fence before any Portal row lock. */
  findPortalRatingGoalBlockInTransaction(
    tx: Tx,
    input: Readonly<{
      organizationId: string
      propertyId: string
      portalId: string
      at: Date
    }>,
  ): Promise<PortalRatingGoalBlock | null>
  findPortalRatingGoalBlock(
    organizationId: string,
    propertyId: string,
    portalId: string,
  ): Promise<'portal' | 'last_collector' | 'staff_scan_target' | null>
}>
export type { GoalProgram, GoalSubjectAssignment } from './ports/goal-program.repository'
export type {
  MonthlyResultNotificationFactsLookup,
  MonthlyResultRevisionNotificationFacts,
} from './ports/monthly-result-notification-facts.lookup'
export type { GoalMetric, GoalSubject } from '../domain/goal-program'
export { buildGoalResultsMatrix } from './goal-results-matrix'
export type {
  GoalResultsMatrix,
  GoalResultsMatrixEvidence,
  GoalResultsMatrixRow,
} from './goal-results-matrix'
export { GoalProgramError } from './use-cases/goal-program-shared'
export type { GoalProgress, GoalProgressReading } from './use-cases/goal-progress'
export type { GoalListProgress } from './use-cases/goal-list-progress'
export type {
  GoalMonthlyResultClosed,
  GoalMonthlyResultReconciled,
  GoalEvent,
} from '../domain/goal-events'
export { goalMonthlyResultClosed } from '../domain/goal-events'

// Dashboard presentation contracts.
export type {
  KPIValue,
  MetricAvailabilityState,
  MetricKPIValue,
  KPIs,
  RecentReview,
  DashboardReplyStatus,
  DashboardData,
  PortalMetricEvidence,
  RatingKPIValue,
  RatingComparisonWithheld,
  PortalAnalyticsData,
  PortalCountKPIValue,
  PortalEngagementFunnel,
  PortalKPIs,
  PortalResponseIntegritySummary,
  PortalRatingLanguages,
  PortalResultsThresholds,
  RatingTrendPoint,
  ReviewVolumePoint,
  AttentionSignals,
  FleetEntry,
  FleetOverviewData,
  FleetRatingGoal,
  FleetTotals,
} from '../domain/dashboard-types'
export type { GoogleNumbersView } from '../domain/google-numbers'
export type {
  PortalResultsSeries,
  PortalSeriesBucket,
  PortalVersionMarker,
} from '../domain/portal-results-series'
export type {
  PortalResultsGroupRow,
  PortalResultsLocalDays,
  PortalResultsMeasures,
  PortalResultsMembership,
  PortalResultsOverview,
  PortalResultsPeriod,
  PortalResultsPortalRow,
  PortalResultsPropertyRow,
  PortalResultsScope,
  PortalResultsTotalRow,
  PortalResultsUngroupedRow,
} from '../domain/portal-results-overview'
export type {
  GetPortalResultsOverviewInput,
  PortalResultsPropertyZone,
  PortalResultsRosterEntry,
  PortalResultsTimeRange,
} from './use-cases/get-portal-results-overview'
export type {
  PropertySetup,
  PropertySetupSection,
  PropertySetupStep,
  PropertySetupStepKey,
  PropertySetupStepStatus,
} from '../domain/property-setup'
export type { PropertySetupSummary } from './use-cases/list-property-setup-summaries'
export type { DashboardError } from '../domain/dashboard-errors'
export {
  GOOGLE_PERFORMANCE_ERROR_CODES,
  PROPERTY_PERFORMANCE_PRESETS,
  isGooglePerformanceErrorCode,
  isPropertyPerformancePreset,
} from '../../../shared/google-performance-report-contract'
export type {
  GooglePerformanceErrorCode,
  PerformanceAvailability,
  PerformanceMetricValue,
  PerformanceSeries,
  PropertyGooglePerformanceReportV1,
  PropertyGooglePerformanceResultV1,
  PropertyPerformancePreset,
} from '../../../shared/google-performance-report-contract'

export type {
  ReadPropertyGoogleNumbersInput,
  ReadPropertyGoogleNumbers,
} from './use-cases/read-property-google-numbers'

export type { PortalLinkTaps } from '../domain/portal-link-taps'
export type { PortalScanPatterns } from '../domain/portal-scan-patterns'
