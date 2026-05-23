// Metric context — build function (composition root)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."
// Returns the public API surface of the metric context.

import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { MetricPublicApi } from './application/public-api'
import { createMetricRepository } from './infrastructure/repositories/metric.repository'
import { recordMetric } from './application/use-cases/record-metric'
import { registerMetricHandlers } from './infrastructure/event-handlers'

export type MetricContextBuildInput = Readonly<{
  db: Database
  events: EventBus
  clock: () => Date
}>

export type MetricContextApi = Readonly<{
  recordMetric: ReturnType<typeof recordMetric>
  publicApi: MetricPublicApi
}>

export const buildMetricContext = (input: MetricContextBuildInput): MetricContextApi => {
  const metricRepo = createMetricRepository(input.db)

  const record = recordMetric({
    metricRepo,
    events: input.events,
    clock: input.clock,
  })

  registerMetricHandlers({
    events: input.events,
    recordMetric: record,
  })

  const publicApi: MetricPublicApi = {
    queryAggregate: (query) => metricRepo.queryAggregate(query),
  }

  return {
    recordMetric: record,
    publicApi,
  }
}
