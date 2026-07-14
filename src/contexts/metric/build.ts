// Metric context — build function (composition root)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."
// Returns the public API surface of the metric context.

import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { OrganizationId, PortalId, PortalGroupId } from '#/shared/domain/ids'
import type { MetricPublicApi } from './application/public-api'
import { createMetricRepository } from './infrastructure/repositories/metric.repository'
import { recordMetric, type RecordMetric } from './application/use-cases/record-metric'
import { registerMetricHandlers } from './infrastructure/event-handlers'
import { metricReadingId } from '#/shared/domain/ids'

export type MetricContextBuildInput = Readonly<{
  db: Database
  events: EventBus
  outboxRepo?: import('#/shared/outbox/infrastructure/outbox-repository').OutboxRepository
  clock: () => Date
  findGroupForPortal: (
    orgId: OrganizationId,
    portalId: PortalId,
  ) => Promise<{ portalGroupId: PortalGroupId } | null>
}>

export type MetricContextApi = Readonly<{
  publicApi: MetricPublicApi
  internal: Readonly<{
    repos: Record<string, never>
    useCases: Readonly<{ recordMetric: RecordMetric }>
  }>
}>

export const buildMetricContext = (input: MetricContextBuildInput): MetricContextApi => {
  const metricRepo = createMetricRepository(input.db, input.clock)

  const record = recordMetric({
    metricRepo,
    events: input.events,
    clock: input.clock,
    idGen: () => metricReadingId(crypto.randomUUID()),
  })

  registerMetricHandlers({
    events: input.events,
    recordMetric: record,
    findGroupForPortal: input.findGroupForPortal,
  })

  const publicApi: MetricPublicApi = {
    queryAggregate: (query) => metricRepo.queryAggregate(query),
  }

  return {
    publicApi,
    internal: { repos: {} as const, useCases: { recordMetric: record } },
  } as const
}
