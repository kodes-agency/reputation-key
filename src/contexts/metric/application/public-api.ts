// Metric context — public API surface for cross-context consumers.
// Other contexts (goal) consume these types to query metric data.
// Per architecture: contexts must not import from another context's internal layers.

import type {
  MetricReadingsQuery,
  MetricReadingsAggregate,
} from './ports/metric.repository'

export type { MetricReadingsQuery, MetricReadingsAggregate }
