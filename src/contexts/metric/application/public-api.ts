// Metric context — public API surface for cross-context consumers.
// Other contexts (goal) consume these types to query metric data.
// Per architecture: contexts must not import from another context's internal layers.

import type {
  MetricReadingsQuery,
  MetricReadingsAggregate,
} from './ports/metric.repository'

export type { MetricReadingsQuery, MetricReadingsAggregate }

/**
 * Application-level API for the Metric context.
 * Cross-context consumers use this interface — never the repository directly.
 */
// ── Event re-exports — cross-context consumers must import events from public-api, not domain/events
export type { MetricRecorded, MetricEvent } from '../domain/events'

export type MetricPublicApi = Readonly<{
  /**
   * Query aggregated metric readings (sum, count, max).
   * Used by Goal context for progress reconciliation.
   */
  queryAggregate: (query: MetricReadingsQuery) => Promise<MetricReadingsAggregate>
}>
