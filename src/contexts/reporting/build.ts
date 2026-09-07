// Reporting context — one composition root for governed metrics, Goal Programs,
// and dashboard read models.

import type { Database } from '#/shared/db'
import type { ConsumerRegistry } from '#/shared/outbox'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  metricReadingId,
  type OrganizationId,
  type PortalGroupId,
  type PortalId,
} from '#/shared/domain/ids'
import type {
  PortalGroupPublicApi,
  PortalPublicApi,
} from '#/contexts/portal/application/public-api'
import type { PropertyFactsPublicApi } from '#/contexts/property/application/public-api'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { ReviewServingStats } from '#/contexts/review/application/public-api'
import type { InboxPublicApi } from '#/contexts/inbox/application/public-api'
import type { MetricPublicApi } from './application/public-api'

import { createMetricRepository } from './infrastructure/repositories/metric.repository'
import { createMetricRegistryRepository } from './infrastructure/repositories/metric-registry.repository'
import { createPropertyLocalDateResolver } from './infrastructure/repositories/property-local-date'
import { createGoalMetricSourceStatus } from './infrastructure/repositories/goal-metric-source-status'
import { createAtomicMetricCommandStore } from './infrastructure/metric-command-store'
import { recordMetric, recordMetrics } from './application/use-cases/record-metric'
import { retractMetrics } from './application/use-cases/retract-metric'
import { registerMetricCorrectionConsumer } from './infrastructure/correction-outbox-consumers'
import { registerPortalWorkflowMetricConsumers } from './infrastructure/outbox-consumers'
import { registerGuestMetricConsumers } from './infrastructure/guest-outbox-consumers'
import { registerPublicReputationMetricConsumers } from './infrastructure/public-reputation-outbox-consumers'
import type { ReviewRatingLookupPort } from './application/ports/review-rating-lookup.port'
import type { MetricReadingsQuery } from './application/ports/metric.repository'
import { queryGoalMetric } from './application/use-cases/query-goal-metric'
import { queryPortalAnalytics } from './application/use-cases/query-portal-analytics'
import { createPortalAnalyticsRepository } from './infrastructure/repositories/portal-analytics.repository'
import { createPortalLifetimeAggregateRepository } from './infrastructure/repositories/portal-lifetime-aggregate.repository'
import { createGoalMetricCorrectionImpactLookup } from './infrastructure/repositories/goal-metric-correction-impact.lookup'
import {
  repairPortalLifetime,
  type RepairPortalLifetimeInput,
} from './application/use-cases/repair-portal-lifetime'
import { createCurrentGoogleReputationSnapshotRepository } from './infrastructure/repositories/current-google-reputation-snapshot.repository'
import { registerCurrentGoogleReputationConsumer } from './infrastructure/current-google-reputation-outbox-consumers'
import { createMetricOrganizationExportAdapter } from './infrastructure/adapters/metric-organization-export.adapter'
import { createMetricOrganizationLifecycleAdapter } from './infrastructure/adapters/metric-organization-lifecycle.adapter'

import { createGoalProgramSubjectReader } from './infrastructure/adapters/goal-program-subject-reader'
import { createGoalProgramRepository } from './infrastructure/repositories/goal-program.repository'
import {
  createGoalProgramService,
  type GoalExecutionPolicy,
  type GoalProgramRequestApi,
} from './application/use-cases/goal-programs'
import type { GoalProgramRepository } from './application/ports/goal-program.repository'
import { createMonthlyResultNotificationFactsLookup } from './infrastructure/adapters/monthly-result-notification-facts.lookup'
import { reconcileMetricCorrection } from './application/use-cases/reconcile-metric-correction'
import { registerGoalMetricCorrectionConsumer } from './infrastructure/metric-correction-outbox-consumers'
import {
  createGoalProgramMaintenanceHandler,
  GOAL_PROGRAM_MAINTENANCE_JOB_NAME,
} from './infrastructure/jobs/goal-program-maintenance.job'
import { createGoalOrganizationExportAdapter } from './infrastructure/adapters/goal-organization-export.adapter'
import { createGoalOrganizationLifecycleAdapter } from './infrastructure/adapters/goal-organization-lifecycle.adapter'

import { createDashboardRepository } from './infrastructure/repositories/dashboard.repository'
import { createMetricStatsAdapter } from './infrastructure/adapters/metric-stats.adapter'
import { createAttentionSignalsAdapter } from './infrastructure/adapters/attention-signals.adapter'
import { createFleetOverviewProjectionAdapter } from './infrastructure/adapters/fleet-overview-projection.adapter'
import { createStaffPortalResolverAdapter } from './infrastructure/adapters/staff-portal-resolver.adapter'
import { getDashboardData } from './application/use-cases/get-dashboard-data'
import {
  getPortalAnalytics,
  type GetPortalAnalyticsDeps,
} from './application/use-cases/get-portal-analytics'
import { getStaffDashboardData } from './application/use-cases/get-staff-dashboard-data'
import {
  getAttentionSignals,
  type GetAttentionSignals,
} from './application/use-cases/get-attention-signals'
import {
  getPropertyOverview,
  type GetPropertyOverview,
} from './application/use-cases/get-property-overview'
import {
  getFleetOverview,
  type GetFleetOverview,
} from './application/use-cases/get-fleet-overview'
import { createDashboardOrganizationExportAdapter } from './infrastructure/adapters/dashboard-organization-export.adapter'
import { createDashboardOrganizationLifecycleAdapter } from './infrastructure/adapters/dashboard-organization-lifecycle.adapter'
import { createSetupChecklistRepository } from './infrastructure/repositories/setup-checklist.repository'
import {
  getSetupChecklist,
  type GetSetupChecklist,
} from './application/use-cases/get-setup-checklist'

export type ReportingContextBuildInput = Readonly<{
  db: Database
  clock: () => Date
  idGen: () => string
  logger: LoggerPort
  portalGroupApi: PortalGroupPublicApi
  portalApi: PortalPublicApi
  reviewRatingLookup: ReviewRatingLookupPort
  propertyApi: PropertyFactsPublicApi
  staffPublicApi: StaffPublicApi
  reviewServingStats: ReviewServingStats
  inboxTargets: Pick<InboxPublicApi, 'getGoogleReviewTargetCountsByProperty'>
  guestResponseIntegrity: GetPortalAnalyticsDeps['responseIntegrity']
}>

function buildMetricModule(input: ReportingContextBuildInput) {
  const metricRepo = createMetricRepository(input.db, input.clock)
  const registry = createMetricRegistryRepository()
  const portalAnalytics = queryPortalAnalytics(
    createPortalAnalyticsRepository(input.db, input.clock),
  )
  const portalLifetime = createPortalLifetimeAggregateRepository(input.db, input.clock)
  const goalCorrectionImpacts = createGoalMetricCorrectionImpactLookup(input.db)
  const currentGoogleReputation = createCurrentGoogleReputationSnapshotRepository(
    input.db,
  )
  const commandStore = createAtomicMetricCommandStore(input.db, input.idGen)
  const readGoalMetric = queryGoalMetric({
    metrics: metricRepo,
    registry,
    sourceStatus: createGoalMetricSourceStatus(input.db, input.portalGroupApi),
    validateSubject: async (orgId, propertyId, subject) => {
      switch (subject.kind) {
        case 'property':
          return subject.propertyId === propertyId
        case 'portal_group':
          return input.portalGroupApi.portalGroupBelongsToProperty(
            orgId,
            propertyId,
            subject.portalGroupId,
          )
        case 'portal': {
          const context = await input.portalApi.resolvePortalContext(subject.portalId)
          return context?.organizationId === orgId && context.propertyId === propertyId
        }
      }
    },
    clock: input.clock,
  })

  const recordDeps = {
    commandStore,
    clock: input.clock,
    idGen: () => metricReadingId(input.idGen()),
    registry,
    resolvePropertyLocalDate: createPropertyLocalDateResolver(input.db),
  }
  const record = recordMetric(recordDeps)
  const recordBatch = recordMetrics(recordDeps)
  const retractBatch = retractMetrics(commandStore)

  const findGroupForPortal = async (
    organizationId: OrganizationId,
    portalId: PortalId,
    asOf: Date,
  ): Promise<{ portalGroupId: PortalGroupId } | null> => {
    const group = await input.portalGroupApi.findGroupForPortal(
      organizationId,
      portalId,
      asOf,
    )
    return group ? { portalGroupId: group.id } : null
  }

  const resolvePortalWorkflowAttribution = async (
    organizationId: OrganizationId,
    portalId: PortalId,
    asOf: Date,
  ) => {
    const context = await input.portalApi.resolvePortalContext(portalId)
    if (!context || context.organizationId !== organizationId) return null
    const group = await input.portalGroupApi.findGroupForPortal(
      organizationId,
      portalId,
      asOf,
    )
    if (group && group.propertyId !== context.propertyId) return null
    return {
      propertyId: context.propertyId,
      portalGroupId: group?.id ?? null,
    }
  }

  const registerOutboxConsumers = (consumerRegistry: ConsumerRegistry): void => {
    registerPortalWorkflowMetricConsumers(consumerRegistry, {
      recordMetric: record,
      resolveAttribution: resolvePortalWorkflowAttribution,
    })
    registerGuestMetricConsumers(consumerRegistry, {
      recordMetrics: recordBatch,
      retractMetrics: retractBatch,
      findGroupForPortal,
      logger: input.logger,
    })
    registerPublicReputationMetricConsumers(consumerRegistry, {
      recordMetric: record,
      reviewRatingLookup: input.reviewRatingLookup,
      db: input.db,
    })
    registerCurrentGoogleReputationConsumer(consumerRegistry, currentGoogleReputation)
    registerMetricCorrectionConsumer(consumerRegistry, input.db)
  }

  return {
    publicApi: {
      queryAggregate: (query: MetricReadingsQuery) => metricRepo.queryAggregate(query),
      queryGoalMetric: readGoalMetric,
      portalAnalytics,
      portalLifetime: Object.freeze({ get: portalLifetime.get }),
      getCurrentOnGoogle: currentGoogleReputation.getCurrentOnGoogle,
      findGoalMetricCorrectionImpacts:
        goalCorrectionImpacts.findGoalMetricCorrectionImpacts,
      getApprovedGoalVersion: async (definitionVersionId: string) => {
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
    },
    maintenance: Object.freeze({
      repairPortalLifetime: (repairInput: RepairPortalLifetimeInput) =>
        repairPortalLifetime({ lifetime: portalLifetime }, repairInput),
    }),
    worker: Object.freeze({ registerOutboxConsumers }),
    organizationExport: createMetricOrganizationExportAdapter(input.db),
    organizationLifecycle: createMetricOrganizationLifecycleAdapter(input.db),
    internal: {
      repos: {} as const,
      useCases: { recordMetric: record },
    },
  } as const
}

function buildGoalModule(input: ReportingContextBuildInput, metricApi: MetricPublicApi) {
  const goalProgramRepo = createGoalProgramRepository(input.db)
  const monthlyResultNotificationFacts = createMonthlyResultNotificationFactsLookup(
    input.db,
  )
  const goalProgramSubjects = createGoalProgramSubjectReader(
    input.propertyApi,
    input.portalApi,
    input.portalGroupApi,
  )
  const buildGoalPrograms = (policy: GoalExecutionPolicy) =>
    createGoalProgramService({
      repository: goalProgramRepo,
      policy,
      subjects: goalProgramSubjects,
      metrics: metricApi,
      id: input.idGen,
      now: input.clock,
    })
  const registerOutboxConsumers = (
    consumerRegistry: ConsumerRegistry,
    policy: GoalExecutionPolicy,
  ): void => {
    const goalPrograms = buildGoalPrograms(policy)
    registerGoalMetricCorrectionConsumer(
      consumerRegistry,
      reconcileMetricCorrection({
        findImpacts: metricApi.findGoalMetricCorrectionImpacts,
        findCandidates: goalProgramRepo.findClosedResultIdsForMetricImpact,
        reconcileClosedResult: goalPrograms.reconcileClosedResult,
      }),
    )
  }
  const programs: GoalProgramRequestApi = Object.freeze({
    create: (policy, ...args) => buildGoalPrograms(policy).create(...args),
    revise: (policy, ...args) => buildGoalPrograms(policy).revise(...args),
    changeAssignments: (policy, ...args) =>
      buildGoalPrograms(policy).changeAssignments(...args),
    changeStatus: (policy, ...args) => buildGoalPrograms(policy).changeStatus(...args),
    get: (policy, ...args) => buildGoalPrograms(policy).get(...args),
    list: (policy, ...args) => buildGoalPrograms(policy).list(...args),
  })

  return {
    publicApi: {
      programs,
      findMonthlyResultNotificationFacts:
        monthlyResultNotificationFacts.findMonthlyResultNotificationFacts,
      findMonthlyResultRevisionNotificationFacts:
        monthlyResultNotificationFacts.findMonthlyResultRevisionNotificationFacts,
    },
    worker: Object.freeze({
      registerOutboxConsumers,
      programMaintenance: Object.freeze({
        jobName: GOAL_PROGRAM_MAINTENANCE_JOB_NAME,
        createHandler: (policy: GoalExecutionPolicy) =>
          createGoalProgramMaintenanceHandler(buildGoalPrograms(policy)),
      }),
    }),
    organizationExport: createGoalOrganizationExportAdapter(input.db),
    organizationLifecycle: createGoalOrganizationLifecycleAdapter(input.db),
    internal: {
      repos: { goalProgramRepo } satisfies Readonly<{
        goalProgramRepo: GoalProgramRepository
      }>,
    },
  } as const
}

function buildDashboardModule(
  input: ReportingContextBuildInput,
  portalMetrics: GetPortalAnalyticsDeps['portalMetrics'],
  portalLifetime: GetPortalAnalyticsDeps['portalLifetime'],
) {
  const metricStats = createMetricStatsAdapter(input.db)
  const attentionSignals = createAttentionSignalsAdapter(input.db, input.clock)
  const fleetOverviewProjection = createFleetOverviewProjectionAdapter(input.db)
  const staffPortalResolver = createStaffPortalResolverAdapter(input.staffPublicApi)
  const dashboardRepo = createDashboardRepository(input.reviewServingStats, metricStats)
  const setupChecklistRepo = createSetupChecklistRepository(input.db)
  const getDashboard = getDashboardData({ repo: dashboardRepo })
  const getPortal = getPortalAnalytics({
    portalMetrics,
    portalLifetime,
    responseIntegrity: input.guestResponseIntegrity,
  })
  const getStaffDashboard = getStaffDashboardData({
    repo: dashboardRepo,
    staffPortalResolver,
    clock: input.clock,
  })
  const getAttention: GetAttentionSignals = getAttentionSignals({
    signals: attentionSignals,
    reviewStats: input.reviewServingStats,
    inboxTargets: input.inboxTargets,
    clock: input.clock,
  })
  const getOverview: GetPropertyOverview = getPropertyOverview({
    getDashboardData: getDashboard,
    attention: attentionSignals,
    inboxTargets: input.inboxTargets,
    clock: input.clock,
  })
  const getFleet: GetFleetOverview = getFleetOverview({
    projection: fleetOverviewProjection,
    resolveAccessiblePropertyIds: (organizationId, scope) =>
      input.staffPublicApi.getAccessiblePropertyIds(
        organizationId,
        scope.userId,
        scope.organizationWide,
      ),
    clock: input.clock,
    inboxTargets: input.inboxTargets,
  })
  const getSetup: GetSetupChecklist = getSetupChecklist({
    repository: setupChecklistRepo,
  })

  return {
    publicApi: {
      getDashboardData: getDashboard,
      getPortalAnalytics: getPortal,
      getStaffDashboardData: getStaffDashboard,
      getAttentionSignals: getAttention,
      getPropertyOverview: getOverview,
      getFleetOverview: getFleet,
      getSetupChecklist: getSetup,
    },
    organizationExport: createDashboardOrganizationExportAdapter(input.db),
    organizationLifecycle: createDashboardOrganizationLifecycleAdapter(input.db),
    internal: {
      repos: { dashboardRepo, setupChecklistRepo },
      useCases: {
        getDashboardData: getDashboard,
        getPortalAnalytics: getPortal,
        getStaffDashboardData: getStaffDashboard,
        getAttentionSignals: getAttention,
        getPropertyOverview: getOverview,
        getFleetOverview: getFleet,
        getSetupChecklist: getSetup,
      },
    },
  } as const
}

export function buildReportingContext(input: ReportingContextBuildInput) {
  const metric = buildMetricModule(input)
  const goal = buildGoalModule(input, metric.publicApi)
  const dashboard = buildDashboardModule(
    input,
    metric.publicApi.portalAnalytics,
    metric.publicApi.portalLifetime,
  )

  return Object.freeze({
    publicApi: Object.freeze({
      ...metric.publicApi,
      ...goal.publicApi,
      ...dashboard.publicApi,
    }),
    maintenance: metric.maintenance,
    worker: Object.freeze({
      registerOutboxConsumers: (
        consumerRegistry: ConsumerRegistry,
        goalPolicy: GoalExecutionPolicy,
      ): void => {
        metric.worker.registerOutboxConsumers(consumerRegistry)
        goal.worker.registerOutboxConsumers(consumerRegistry, goalPolicy)
      },
      programMaintenance: goal.worker.programMaintenance,
    }),
    organizationExport: Object.freeze({
      metric: metric.organizationExport,
      goal: goal.organizationExport,
      dashboard: dashboard.organizationExport,
    }),
    organizationLifecycle: Object.freeze({
      metric: metric.organizationLifecycle,
      goal: goal.organizationLifecycle,
      dashboard: dashboard.organizationLifecycle,
    }),
    internal: Object.freeze({
      repos: {
        ...metric.internal.repos,
        ...goal.internal.repos,
        ...dashboard.internal.repos,
      },
      useCases: {
        ...metric.internal.useCases,
        ...dashboard.internal.useCases,
      },
    }),
  } as const)
}
