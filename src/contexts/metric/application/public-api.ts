// Metric context — public API surface for cross-context consumers.
// Other contexts (goal) consume these types to query metric data.
// Per architecture: contexts must not import from another context's internal layers.

import type {
  MetricReadingsQuery,
  MetricReadingsAggregate,
} from './ports/metric.repository'
import type { GovernedMetricVersion } from '../domain/metric-registry'
import type {
  GovernedGoalMetricQuery,
  GovernedGoalMetricResult,
} from './use-cases/query-goal-metric'
import type { PortalAnalyticsQueries } from './use-cases/query-portal-analytics'
import type { PortalLifetimeAggregatePort } from './ports/portal-lifetime-aggregate.port'
import type { GoalMetricCorrectionImpactLookup } from './ports/goal-metric-correction-impact.lookup'
import type { CurrentGoogleReputationSnapshotStore } from './ports/current-google-reputation-snapshot.port'

export type { MetricReadingsQuery, MetricReadingsAggregate }
export type { GovernedGoalMetricQuery, GovernedGoalMetricResult }
export type {
  PortalMetricSumRow,
  PortalRatingBucket,
  PortalRatingTrendPoint,
  PortalMetricEvidence,
  PortalMetricEvidenceSet,
  PortalMetricFamily,
} from './ports/portal-analytics.repository'

/**
 * Application-level API for the Metric context.
 * Cross-context consumers use this interface — never the repository directly.
 */
// ── Event re-exports — cross-context consumers must import events from public-api, not domain/events
export type { MetricRecorded, MetricEvent } from '../domain/events'
export { METRIC_VERSION_IDS } from '../domain/metric-registry'
export type { GovernedMetricVersion } from '../domain/metric-registry'
export type {
  PortalLifetimeAggregate,
  PortalLifetimeAggregatePort,
  PortalLifetimeInspection,
  PortalLifetimeReconciliation,
  PortalLifetimeScope,
} from './ports/portal-lifetime-aggregate.port'

/** Cross-context lifetime reads. Projection repair and retention sealing stay
 * behind Metric-owned maintenance/lifecycle authorities. */
export type PortalLifetimeReadApi = Readonly<Pick<PortalLifetimeAggregatePort, 'get'>>
export type {
  FindGoalMetricCorrectionImpactsInput,
  GoalMetricCorrectionImpact,
  GoalMetricCorrectionImpactLookup,
} from './ports/goal-metric-correction-impact.lookup'
export type {
  CurrentOnGoogleReputationSnapshot,
  VerifiedGoogleReputationSnapshotFact,
} from './ports/current-google-reputation-snapshot.port'

export type MetricPublicApi = Readonly<{
  /**
   * Query aggregated metric readings (sum, count, max).
   * Used by Goal context for progress reconciliation.
   */
  queryAggregate: (query: MetricReadingsQuery) => Promise<MetricReadingsAggregate>
  /** Version-pinned, half-open monthly read with durable source completeness. */
  queryGoalMetric: (query: GovernedGoalMetricQuery) => Promise<GovernedGoalMetricResult>
  /** Governed, correction-aware Portal analytics reads. */
  portalAnalytics: PortalAnalyticsQueries
  /** Anonymous All-Time values; mutation remains context-owned. */
  portalLifetime: PortalLifetimeReadApi
  /** Latest fully verified provider aggregate. This is not a period metric. */
  getCurrentOnGoogle: CurrentGoogleReputationSnapshotStore['getCurrentOnGoogle']
  /** Exact Metric-owned facts affected by one append-only correction. */
  findGoalMetricCorrectionImpacts: GoalMetricCorrectionImpactLookup['findGoalMetricCorrectionImpacts']
  /** Resolve one immutable, approved version for a governed Goal definition. */
  getApprovedGoalVersion?: (
    definitionVersionId: string,
  ) => Promise<GovernedMetricVersion | null>
}>
