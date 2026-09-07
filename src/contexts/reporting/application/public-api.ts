// Reporting context — the single cross-context interface for metrics, goals,
// and dashboard reads. Implementation modules inside this context import one
// another directly through the normal layer rules rather than through this file.

import type {
  MetricReadingsAggregate,
  MetricReadingsQuery,
} from './ports/metric.repository'
import type { GoalMetricCorrectionImpactLookup } from './ports/goal-metric-correction-impact.lookup'
import type { CurrentGoogleReputationSnapshotStore } from './ports/current-google-reputation-snapshot.port'
import type { PortalLifetimeAggregatePort } from './ports/portal-lifetime-aggregate.port'
import type { PortalAnalyticsQueries } from './use-cases/query-portal-analytics'
import type {
  GovernedGoalMetricQuery,
  GovernedGoalMetricResult,
} from './use-cases/query-goal-metric'
import type { GovernedMetricVersion } from '../domain/metric-registry'

// Metric contracts.
export type { MetricReadingsQuery, MetricReadingsAggregate }
export type { GovernedGoalMetricQuery, GovernedGoalMetricResult }
export type {
  MetricPortalMetricEvidence,
  MetricPortalMetricEvidenceSet,
  MetricPortalRatingTrendPoint,
  PortalMetricSumRow,
  PortalRatingBucket,
} from './ports/portal-analytics.repository'
export type { MetricRecorded, MetricEvent } from '../domain/metric-events'
export {
  METRIC_DEFINITION_IDS,
  METRIC_DEFINITIONS,
  METRIC_VERSION_IDS,
  findMetricVersionById,
} from '../domain/metric-registry'
export type {
  GovernedMetricVersion,
  SeededMetricRegistryEntry,
} from '../domain/metric-registry'
export type { PortalLifetimeAggregatePort } from './ports/portal-lifetime-aggregate.port'

/** Cross-context lifetime reads; mutation remains Reporting-owned. */
export type PortalLifetimeReadApi = Readonly<Pick<PortalLifetimeAggregatePort, 'get'>>
export type {
  FindGoalMetricCorrectionImpactsInput,
  GoalMetricCorrectionImpact,
} from './ports/goal-metric-correction-impact.lookup'

export type MetricPublicApi = Readonly<{
  queryAggregate: (query: MetricReadingsQuery) => Promise<MetricReadingsAggregate>
  queryGoalMetric: (query: GovernedGoalMetricQuery) => Promise<GovernedGoalMetricResult>
  portalAnalytics: PortalAnalyticsQueries
  portalLifetime: PortalLifetimeReadApi
  getCurrentOnGoogle: CurrentGoogleReputationSnapshotStore['getCurrentOnGoogle']
  findGoalMetricCorrectionImpacts: GoalMetricCorrectionImpactLookup['findGoalMetricCorrectionImpacts']
  getApprovedGoalVersion?: (
    definitionVersionId: string,
  ) => Promise<GovernedMetricVersion | null>
}>

// Goal contracts.
export type { GoalExecutionPolicy } from './ports/goal-execution-policy'
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
export type { GoalAssignmentChangeOutcome } from './use-cases/goal-programs'
export { GoalProgramError } from './use-cases/goal-programs'
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
  PortalAnalyticsData,
  PortalLifetimeReconciliationState,
  PortalResponseIntegritySummary,
  PortalRatingTrendPoint,
  RatingTrendPoint,
  ReviewVolumePoint,
  AttentionSignals,
  FleetEntry,
  FleetOverviewData,
  FleetMetricEvidence,
  FleetTotals,
} from '../domain/dashboard-types'
export type {
  SetupChecklist,
  SetupChecklistAction,
  SetupChecklistStep,
} from './use-cases/get-setup-checklist'
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
