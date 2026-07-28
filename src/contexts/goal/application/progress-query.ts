// Goal context — progress-query mapping (single source, BQC-5.9 E2).
//
// The create-goal use case and the reconcile-goal-progress job must derive
// the SAME metric query and the SAME progress value for a goal. This module
// is the shared invariant — neither caller may grow its own copy.
//
// Lives in application (not domain) because the query/aggregate contract
// types belong to the metric context's application public API, which the
// domain layer must not import.

import type {
  MetricReadingsQuery,
  MetricReadingsAggregate,
} from '#/contexts/metric/application/public-api'
import { assertNever } from '#/shared/domain/assert'
import type { AggregationFunction } from '#/shared/domain/metric-keys'
import type { Goal } from '../domain/types'
import type { ProgressQuery } from '../domain/progress-strategy'

/** Map a goal progress query to the metric-readings query that serves it. */
export function progressQueryToMetricReadingsQuery(
  pq: ProgressQuery,
  goal: Goal,
): MetricReadingsQuery {
  const base: MetricReadingsQuery = {
    organizationId: goal.organizationId,
    propertyId: pq.scopeFilter.propertyId,
    portalId: pq.scopeFilter.portalId,
    groupId: pq.scopeFilter.portalGroupId,
    metricKey: pq.metricKey,
  }

  switch (pq.timeFilter.tag) {
    case 'bounded':
      return {
        ...base,
        periodStart: pq.timeFilter.start,
        periodEnd: pq.timeFilter.end,
      }
    case 'sliding_window':
      return {
        ...base,
        rollingWindowDays: pq.timeFilter.days,
      }
    case 'none':
      return base
  }
}

/** Reduce a metric-readings aggregate to the goal's progress value. */
export function computeValue(
  agg: AggregationFunction,
  aggregate: MetricReadingsAggregate,
): number {
  switch (agg) {
    case 'sum':
      return aggregate.sum
    case 'count':
      return aggregate.count
    case 'max':
      return aggregate.max
    case 'avg':
      return aggregate.count > 0 ? aggregate.sum / aggregate.count : 0
    default:
      assertNever('aggregation', agg)
  }
}
