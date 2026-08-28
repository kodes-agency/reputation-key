// Metric context — build function (composition root)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."
// Returns the public API surface of the metric context.

import type { Database } from '#/shared/db'
import type { ConsumerRegistry } from '#/shared/outbox'
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
import { createGoalMetricSourceStatus } from './infrastructure/repositories/goal-metric-source-status'
import { createAtomicMetricCommandStore } from './infrastructure/metric-command-store'
import { recordMetric, type RecordMetric } from './application/use-cases/record-metric'
import { retractMetric } from './application/use-cases/retract-metric'
import { registerMetricHandlers } from './infrastructure/event-handlers'
import { registerMetricCorrectionConsumer } from './infrastructure/correction-outbox-consumers'
import { registerPortalWorkflowMetricConsumers } from './infrastructure/outbox-consumers'
import { registerGuestMetricConsumers } from './infrastructure/guest-outbox-consumers'
import { registerPublicReputationMetricConsumers } from './infrastructure/public-reputation-outbox-consumers'
import { metricReadingId } from '#/shared/domain/ids'
import type { ReviewRatingLookupPort } from './application/ports/review-rating-lookup.port'
import { queryGoalMetric } from './application/use-cases/query-goal-metric'
import { queryPortalAnalytics } from './application/use-cases/query-portal-analytics'
import { createPortalAnalyticsRepository } from './infrastructure/repositories/portal-analytics.repository'
import { createPortalLifetimeAggregateRepository } from './infrastructure/repositories/portal-lifetime-aggregate.repository'
import { createGoalMetricCorrectionImpactLookup } from './infrastructure/repositories/goal-metric-correction-impact.lookup'
import {
  repairPortalLifetime,
  type RepairPortalLifetimeResult,
} from './application/use-cases/repair-portal-lifetime'
import type { PortalLifetimeScope } from './application/ports/portal-lifetime-aggregate.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { createCurrentGoogleReputationSnapshotRepository } from './infrastructure/repositories/current-google-reputation-snapshot.repository'
import { registerCurrentGoogleReputationConsumer } from './infrastructure/current-google-reputation-outbox-consumers'
import { createMetricOrganizationExportAdapter } from './infrastructure/adapters/metric-organization-export.adapter'
import { createMetricOrganizationLifecycleAdapter } from './infrastructure/adapters/metric-organization-lifecycle.adapter'

export type MetricContextBuildInput = Readonly<{
  db: Database
  events: EventBus
  clock: () => Date
  idGen: () => string
  logger: LoggerPort
  /** Portal group resolution (portal public API) — the build wraps it into
   * the findGroupForPortal shape the event handlers consume. */
  portalGroupApi: PortalGroupPublicApi
  portalApi: PortalPublicApi
  reviewRatingLookup: ReviewRatingLookupPort
}>

export type MetricContextApi = Readonly<{
  publicApi: MetricPublicApi
  /** Operator-only projection maintenance. The report-first contract remains
   * context-owned instead of being published through the application API. */
  maintenance: Readonly<{
    repairPortalLifetime: (
      input: Readonly<{
        scope: PortalLifetimeScope
        mode: 'report' | 'apply'
      }>,
    ) => Promise<RepairPortalLifetimeResult>
  }>
  /** Context-owned worker registration; exposes no repositories or use cases. */
  worker: Readonly<{
    registerOutboxConsumers: (consumerRegistry: ConsumerRegistry) => void
  }>
  /**
   * LIF-01 Organization Export contributor. Deliberately outside `publicApi`:
   * only Identity's bundle builder consumes it, and no tenant-reachable
   * surface gains a key from wiring it here.
   */
  organizationExport: ReturnType<typeof createMetricOrganizationExportAdapter>
  /**
   * LIF-01 Organization lifecycle contributor. Deliberately outside
   * `publicApi` for the same reason: only Identity's lifecycle coordinator
   * consumes it, and the coordinator itself is composed only under an
   * explicitly reviewed composition.
   */
  organizationLifecycle: ReturnType<typeof createMetricOrganizationLifecycleAdapter>
  internal: Readonly<{
    repos: Record<string, never>
    useCases: Readonly<{
      recordMetric: RecordMetric
    }>
  }>
}>

export const buildMetricContext = (input: MetricContextBuildInput): MetricContextApi => {
  const metricRepo = createMetricRepository(input.db, input.clock)
  const registry = createMetricRegistryRepository(input.db)
  const portalAnalytics = queryPortalAnalytics(
    createPortalAnalyticsRepository(input.db, input.clock),
  )
  const portalLifetime = createPortalLifetimeAggregateRepository(input.db, input.clock)
  const goalCorrectionImpacts = createGoalMetricCorrectionImpactLookup(input.db)
  const currentGoogleReputation = createCurrentGoogleReputationSnapshotRepository(
    input.db,
  )
  // BQC-3.5: every metric state mutation + fact commits atomically here.
  const commandStore = createAtomicMetricCommandStore(input.db, input.events, input.idGen)
  const readGoalMetric = queryGoalMetric({
    metrics: metricRepo,
    registry,
    sourceStatus: createGoalMetricSourceStatus(input.db, input.portalGroupApi),
    validateSubject: async (orgId, propertyIdParam, subject) => {
      switch (subject.kind) {
        case 'property':
          return subject.propertyId === propertyIdParam
        case 'portal_group':
          return input.portalGroupApi.portalGroupBelongsToProperty(
            orgId,
            propertyIdParam,
            subject.portalGroupId,
          )
        case 'portal': {
          const context = await input.portalApi.resolvePortalContext(subject.portalId)
          return (
            context?.organizationId === orgId && context.propertyId === propertyIdParam
          )
        }
      }
    },
    clock: input.clock,
  })

  const record = recordMetric({
    commandStore,
    clock: input.clock,
    idGen: () => metricReadingId(input.idGen()),
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
    retractMetric: retractMetric(commandStore),
    findGroupForPortal,
    reviewRatingLookup: input.reviewRatingLookup,
    resolvePortalWorkflowAttribution,
    logger: input.logger,
  })

  const registerOutboxConsumers = (consumerRegistry: ConsumerRegistry) => {
    const portalWorkflowDeps = {
      recordMetric: record,
      resolveAttribution: resolvePortalWorkflowAttribution,
    }
    registerPortalWorkflowMetricConsumers(consumerRegistry, portalWorkflowDeps)
    registerGuestMetricConsumers(consumerRegistry, {
      recordMetric: record,
      retractMetric: retractMetric(commandStore),
      findGroupForPortal,
      logger: input.logger,
    })
    registerPublicReputationMetricConsumers(consumerRegistry, {
      recordMetric: record,
      reviewRatingLookup: input.reviewRatingLookup,
    })
    registerCurrentGoogleReputationConsumer(consumerRegistry, currentGoogleReputation)
    registerMetricCorrectionConsumer(consumerRegistry, input.db)
  }

  const publicApi: MetricPublicApi = {
    queryAggregate: (query) => metricRepo.queryAggregate(query),
    queryGoalMetric: readGoalMetric,
    portalAnalytics,
    portalLifetime: Object.freeze({ get: portalLifetime.get }),
    getCurrentOnGoogle: currentGoogleReputation.getCurrentOnGoogle,
    findGoalMetricCorrectionImpacts:
      goalCorrectionImpacts.findGoalMetricCorrectionImpacts,
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
    maintenance: Object.freeze({
      repairPortalLifetime: (repairInput) =>
        repairPortalLifetime({ lifetime: portalLifetime }, repairInput),
    }),
    worker: Object.freeze({ registerOutboxConsumers }),
    organizationExport: createMetricOrganizationExportAdapter(input.db),
    organizationLifecycle: createMetricOrganizationLifecycleAdapter(input.db),
    internal: {
      repos: {} as const,
      useCases: {
        recordMetric: record,
      },
    },
  } as const
}
