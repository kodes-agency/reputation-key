// Metric context — build function (composition root)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."
// Returns the public API surface of the metric context.

import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { OrganizationId, PortalId, PortalGroupId } from '#/shared/domain/ids'
import type {
  PortalGroupPublicApi,
  PortalPublicApi,
} from '#/contexts/portal/application/public-api'
import type { MetricPublicApi } from './application/public-api'
import { createMetricRepository } from './infrastructure/repositories/metric.repository'
import { createMetricRegistryRepository } from './infrastructure/repositories/metric-registry.repository'
import { createPropertyLocalDateResolver } from './infrastructure/repositories/property-local-date'
import { createAtomicMetricCommandStore } from './infrastructure/metric-command-store'
import { recordMetric, type RecordMetric } from './application/use-cases/record-metric'
import { registerMetricHandlers } from './infrastructure/event-handlers'
import { registerMetricCorrectionConsumer } from './infrastructure/correction-outbox-consumers'
import { registerPortalWorkflowMetricConsumers } from './infrastructure/outbox-consumers'
import { registerGuestMetricConsumers } from './infrastructure/guest-outbox-consumers'
import { metricReadingId } from '#/shared/domain/ids'
import type { ReviewRatingLookupPort } from './application/ports/review-rating-lookup.port'

export type MetricContextBuildInput = Readonly<{
  db: Database
  events: EventBus
  clock: () => Date
  /** Portal group resolution (portal public API) — the build wraps it into
   * the findGroupForPortal shape the event handlers consume. */
  portalGroupApi: PortalGroupPublicApi
  portalApi: PortalPublicApi
  reviewRatingLookup: ReviewRatingLookupPort
}>

export type MetricContextApi = Readonly<{
  publicApi: MetricPublicApi
  internal: Readonly<{
    repos: Record<string, never>
    registerOutboxConsumers: () => void
    useCases: Readonly<{ recordMetric: RecordMetric }>
  }>
}>

export const buildMetricContext = (input: MetricContextBuildInput): MetricContextApi => {
  const metricRepo = createMetricRepository(input.db, input.clock)
  const registry = createMetricRegistryRepository(input.db)
  // BQC-3.5: every metric state mutation + fact commits atomically here.
  const commandStore = createAtomicMetricCommandStore(input.db, input.events)

  const record = recordMetric({
    commandStore,
    clock: input.clock,
    idGen: () => metricReadingId(crypto.randomUUID()),
    registry,
    resolvePropertyLocalDate: createPropertyLocalDateResolver(input.db),
  })

  // Resolve the portal's group for metric attribution — portal public API.
  const findGroupForPortal = async (
    orgId: OrganizationId,
    pid: PortalId,
    asOf: Date,
  ): Promise<{ portalGroupId: PortalGroupId } | null> => {
    const group = await input.portalGroupApi.findGroupForPortal(orgId, pid, asOf)
    return group ? { portalGroupId: group.id } : null
  }

  const resolvePortalWorkflowAttribution = async (
    orgId: OrganizationId,
    pid: PortalId,
    asOf: Date,
  ) => {
    const context = await input.portalApi.resolvePortalContext(pid)
    if (!context || context.organizationId !== orgId) return null
    const group = await input.portalGroupApi.findGroupForPortal(orgId, pid, asOf)
    if (group && group.propertyId !== context.propertyId) return null
    return {
      propertyId: context.propertyId,
      portalGroupId: group?.id ?? null,
    }
  }

  registerMetricHandlers({
    events: input.events,
    recordMetric: record,
    findGroupForPortal,
    reviewRatingLookup: input.reviewRatingLookup,
    resolvePortalWorkflowAttribution,
  })

  const registerOutboxConsumers = () => {
    const portalWorkflowDeps = {
      recordMetric: record,
      resolveAttribution: resolvePortalWorkflowAttribution,
    }
    registerPortalWorkflowMetricConsumers(portalWorkflowDeps)
    registerGuestMetricConsumers({ recordMetric: record, findGroupForPortal })
    registerMetricCorrectionConsumer(input.db)
  }

  const publicApi: MetricPublicApi = {
    queryAggregate: (query) => metricRepo.queryAggregate(query),
    getApprovedGoalVersion: async (definitionVersionId) => {
      const governed = await registry.findVersionById(definitionVersionId)
      if (
        !governed ||
        governed.definition.lifecycleStatus !== 'approved' ||
        governed.version.employmentDecisionEligible ||
        !governed.version.permittedConsumers.includes('goal')
      ) {
        return null
      }
      return governed
    },
  }

  return {
    publicApi,
    internal: {
      repos: {} as const,
      useCases: { recordMetric: record },
      registerOutboxConsumers,
    },
  } as const
}
