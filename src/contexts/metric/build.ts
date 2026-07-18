// Metric context — build function (composition root)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."
// Returns the public API surface of the metric context.

import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { OrganizationId, PortalId, PortalGroupId } from '#/shared/domain/ids'
import type { MetricPublicApi } from './application/public-api'
import { createMetricRepository } from './infrastructure/repositories/metric.repository'
import { createAtomicMetricCommandStore } from './infrastructure/metric-command-store'
import { recordMetric, type RecordMetric } from './application/use-cases/record-metric'
import { registerMetricHandlers } from './infrastructure/event-handlers'
import { metricReadingId } from '#/shared/domain/ids'
import type { ReviewRatingLookupPort } from './application/ports/review-rating-lookup.port'

export type MetricContextBuildInput = Readonly<{
  db: Database
  events: EventBus
  clock: () => Date
  findGroupForPortal: (
    orgId: OrganizationId,
    portalId: PortalId,
  ) => Promise<{ portalGroupId: PortalGroupId } | null>
  reviewRatingLookup: ReviewRatingLookupPort
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
  // BQC-3.5: every metric state mutation + fact commits atomically here.
  const commandStore = createAtomicMetricCommandStore(input.db, input.events)

  const record = recordMetric({
    commandStore,
    clock: input.clock,
    idGen: () => metricReadingId(crypto.randomUUID()),
  })

  registerMetricHandlers({
    events: input.events,
    recordMetric: record,
    findGroupForPortal: input.findGroupForPortal,
    reviewRatingLookup: input.reviewRatingLookup,
  })

  const publicApi: MetricPublicApi = {
    queryAggregate: (query) => metricRepo.queryAggregate(query),
  }

  return {
    publicApi,
    internal: { repos: {} as const, useCases: { recordMetric: record } },
  } as const
}
