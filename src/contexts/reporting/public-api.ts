import type { Tx } from '#/shared/outbox/commit'
import type { PortalRatingGoalBlock } from './monthly-goals/running-portal-rating-goal.server'
// Reporting context — the single cross-context interface for metrics, goals,
// and dashboard reads. Implementation modules inside this context import one
// another directly through the normal layer rules rather than through this file.

import type { GoalMetricCorrectionImpactLookup } from './monthly-goals/goal-metric-correction-impact-lookup.port.server'
import type { CurrentGoogleReputationSnapshotStore } from './readings/current-google-reputation-snapshot-repository.port.server'
import type { PortalAnalyticsRepository } from './portal-results/portal-analytics.repository.port.server'
import type {
  GovernedGoalMetricQuery,
  GovernedGoalMetricResult,
} from './readings/query-goal-metric.server'
import type { GovernedMetricVersion } from './readings/contracts'

// Metric contracts.
export type { GovernedGoalMetricQuery, GovernedGoalMetricResult }
export type {
  MetricPortalMetricEvidence,
  MetricPortalMetricEvidenceSet,
  PortalMetricSumRow,
  PortalRatingBucket,
} from './portal-results/portal-analytics.repository.port.server'
export type { MetricRecorded, MetricEvent } from './domain/metric-events'
export {
  METRIC_DEFINITION_IDS,
  METRIC_VERSION_IDS,
  findMetricVersionById,
} from './readings/contracts'
export type {
  GovernedMetricVersion,
  SeededMetricRegistryEntry,
} from './readings/contracts'

export type {
  FindGoalMetricCorrectionImpactsInput,
  GoalMetricCorrectionImpact,
} from './monthly-goals/goal-metric-correction-impact-lookup.port.server'

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
export type {
  GoalProgram,
  GoalSubjectAssignment,
} from './application/ports/goal-program.repository'
export type {
  MonthlyResultNotificationFactsLookup,
  MonthlyResultRevisionNotificationFacts,
} from './monthly-goals/monthly-result-notification-facts-lookup.port.server'
export type { GoalMetric, GoalSubject } from './domain/goal-program'
export { goalSubjectIdentity } from './domain/goal-subject'
export { buildGoalResultsMatrix } from './application/goal-results-matrix'
export type {
  GoalResultsMatrix,
  GoalResultsMatrixEvidence,
  GoalResultsMatrixRow,
} from './application/goal-results-matrix'
export { GoalProgramError } from './application/use-cases/goal-program-shared'
export type {
  GoalProgress,
  GoalProgressReading,
} from './monthly-goals/goal-progress.server'
export type { GoalListProgress } from './monthly-goals/goal-list-progress.server'
export type {
  GoalMonthlyResultClosed,
  GoalMonthlyResultReconciled,
  GoalEvent,
} from './domain/goal-events'
export { goalMonthlyResultClosed } from './domain/goal-events'

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
} from './domain/dashboard-types'
export type { GoogleNumbersView } from './domain/google-numbers'
export type {
  PortalResultsSeries,
  PortalSeriesBucket,
  PortalVersionMarker,
} from './domain/portal-results-series'
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
} from './domain/portal-results-overview'
export type {
  GetPortalResultsOverviewInput,
  PortalResultsPropertyZone,
  PortalResultsRosterEntry,
  PortalResultsTimeRange,
} from './portal-results/get-portal-results-overview.server'
export type {
  PropertySetup,
  PropertySetupSection,
  PropertySetupStep,
  PropertySetupStepKey,
  PropertySetupStepStatus,
} from './domain/property-setup'
export type { PropertySetupSummary } from './property-overview/list-property-setup-summaries.server'
export type { DashboardError } from './domain/dashboard-errors'
export {
  GOOGLE_PERFORMANCE_ERROR_CODES,
  PROPERTY_PERFORMANCE_PRESETS,
  isGooglePerformanceErrorCode,
  isPropertyPerformancePreset,
} from '../../shared/google-contracts/google-performance-report-contract'
export type {
  GooglePerformanceErrorCode,
  PerformanceAvailability,
  PerformanceMetricValue,
  PerformanceSeries,
  PropertyGooglePerformanceReportV1,
  PropertyGooglePerformanceResultV1,
  PropertyPerformancePreset,
} from '../../shared/google-contracts/google-performance-report-contract'

export type {
  ReadPropertyGoogleNumbersInput,
  ReadPropertyGoogleNumbers,
} from './property-overview/read-property-google-numbers.server'

export type { PortalLinkTaps } from './domain/portal-link-taps'
export type { PortalScanPatterns } from './domain/portal-scan-patterns'
