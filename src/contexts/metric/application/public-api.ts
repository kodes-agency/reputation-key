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

export type { MetricReadingsQuery, MetricReadingsAggregate }
export type { GovernedGoalMetricQuery, GovernedGoalMetricResult }
export type {
  PortalMetricSumRow,
  PortalRatingBucket,
  PortalRatingTrendPoint,
} from './ports/portal-analytics.repository'

/**
 * Application-level API for the Metric context.
 * Cross-context consumers use this interface — never the repository directly.
 */
// ── Event re-exports — cross-context consumers must import events from public-api, not domain/events
export type { MetricRecorded, MetricEvent } from '../domain/events'
export { METRIC_VERSION_IDS } from '../domain/metric-registry'
export type { GovernedMetricVersion } from '../domain/metric-registry'

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
  /** Resolve one immutable, approved version for a governed Goal definition. */
  getApprovedGoalVersion?: (
    definitionVersionId: string,
  ) => Promise<GovernedMetricVersion | null>
}>
