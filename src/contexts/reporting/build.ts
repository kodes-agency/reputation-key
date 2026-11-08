import { createGoalMetricBatchReader } from './infrastructure/repositories/goal-metric-batch-reader'
import { findPortalRatingGoalBlock } from './application/running-portal-rating-goal'
import { createStaffResultsReader } from './infrastructure/repositories/staff-results.reader'
import { getPortalLinkTaps } from './application/use-cases/get-portal-link-taps'
// Reporting context — one composition root for governed metrics, Goal Programs,
// and dashboard read models.

import type { Database } from '#/shared/db'
import type { ConsumerRegistry } from '#/shared/outbox'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  metricReadingId,
  organizationId as toOrganizationId,
  propertyId as toPropertyId,
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
import type {
  ReviewGoogleRatingReads,
  ReviewServingStats,
} from '#/contexts/review/application/public-api'
import type { InboxPublicApi } from '#/contexts/inbox/application/public-api'
import type { MetricPublicApi, PortalRatingGoalReadApi } from './application/public-api'

import { createMetricRegistryRepository } from './infrastructure/repositories/metric-registry.repository'
import { createPropertyLocalDateResolver } from './infrastructure/repositories/property-local-date'
import { createGoalMetricSnapshotReader } from './infrastructure/repositories/goal-metric-snapshot'
import { createAtomicMetricCommandStore } from './readings/metric-command-store.server'
import { recordMetric, recordMetrics } from './application/use-cases/record-metric'
import { retractMetrics } from './application/use-cases/retract-metric'
import { registerGuestMetricConsumers } from './readings/guest-outbox-consumers.server'
import { queryGoalMetric } from './application/use-cases/query-goal-metric'
import { createPortalAnalyticsRepository } from './portal-results/portal-analytics.repository.server'
import { createPortalResultsOverviewRepository } from './infrastructure/repositories/portal-results-overview.repository'
import { createGoalMetricCorrectionImpactLookup } from './infrastructure/repositories/goal-metric-correction-impact.lookup'
import { createCurrentGoogleReputationSnapshotRepository } from './infrastructure/repositories/current-google-reputation-snapshot.repository'
import { registerCurrentGoogleReputationConsumer } from './infrastructure/current-google-reputation-outbox-consumers'

import { createGoalProgramSubjectReader } from './infrastructure/adapters/goal-program-subject-reader'
import { createGoalProgramVisibilityAdapter } from './infrastructure/adapters/goal-program-visibility.adapter'
import { createGoalProgramRepository } from './infrastructure/repositories/goal-program.repository'
import {
  createGoalProgramService,
  type GoalExecutionPolicy,
  type GoalProgramRequestApi,
} from './application/use-cases/goal-programs'
import { withGoalProgramVisibility } from './application/use-cases/goal-program-visibility'
import { createGoalsForSubjects } from './application/use-cases/goal-bulk-create'
import {
  readPortalGoalRecommendation,
  type PortalGoalRecommendationRequestApi,
} from './application/use-cases/goal-recommendation-read'
import type { GoalRecommendationFactsPort } from './application/ports/goal-recommendation-facts.port'
import { readMonthlyPortalGoalCard } from './application/use-cases/monthly-portal-goal-card'
import {
  readMonthlyPortalGoalPage,
  type MonthlyPortalGoalRequestApi,
} from './application/use-cases/monthly-portal-goal-page'
import {
  changeMonthlyPortalGoalNow,
  deferMonthlyPortalGoalPrompt,
  keepMonthlyPortalGoal,
  reviseMonthlyPortalGoal,
  setMonthlyPortalGoal,
  stopMonthlyPortalGoal,
} from './application/use-cases/monthly-portal-goal'
import {
  addPortalGoal,
  addPortalGoals,
  type PortalGoalAddDeps,
  type PortalGoalAddRequestApi,
} from './application/use-cases/portal-goal-add'
import { readPortalGoalAddOptions } from './application/use-cases/portal-goal-add-options'
import { readMonthlyPortalGoalLine } from './application/use-cases/monthly-portal-goal-line'
import { createPortalGoalPromptDeferralStore } from './infrastructure/repositories/portal-goal-prompt-deferrals.repository'
import {
  readPortalGoalSinglePage,
  type PortalGoalSinglePageRequestApi,
} from './application/use-cases/portal-goal-single-page'
import { readGoalRecommendationCounts } from './infrastructure/adapters/goal-recommendation-readings'
import {
  createGoalProgramProgressReader,
  createGoalProgressReader,
  type GoalProgressRequestApi,
} from './application/use-cases/goal-progress'
import {
  createGoalListProgressReader,
  type GoalListProgressRequestApi,
} from './application/use-cases/goal-list-progress'
import type { GoalProgramRepository } from './application/ports/goal-program.repository'
import {
  createPropertyRatingGoalRepository,
  createRatingGoalPropertyFactsReader,
} from './infrastructure/repositories/property-rating-goal.repository'
import {
  createArchivedPropertyRatingGoalEnder,
  createRatingGoalEvaluator,
  createRatingGoalRequestApi,
} from './application/use-cases/rating-goals'
import { registerRatingGoalEvaluationConsumer } from './infrastructure/rating-goal-outbox-consumers'
import {
  sweepRatingGoals,
  type AuthorizeRatingGoalScope,
} from './application/use-cases/rating-goal-sweep'
import {
  createRatingGoalEvaluationJobHandler,
  RATING_GOAL_EVALUATION_JOB_NAME,
} from './infrastructure/jobs/rating-goal-evaluation.job'
import { registerRatingGoalPropertyLifecycleConsumer } from './infrastructure/rating-goal-property-lifecycle-consumers'
import { createMonthlyResultNotificationFactsLookup } from './infrastructure/adapters/monthly-result-notification-facts.lookup'
import { reconcileMetricCorrection } from './application/use-cases/reconcile-metric-correction'
import { registerGoalMetricCorrectionConsumer } from './infrastructure/metric-correction-outbox-consumers'
import {
  createGoalProgramMaintenanceHandler,
  GOAL_PROGRAM_MAINTENANCE_JOB_NAME,
} from './infrastructure/jobs/goal-program-maintenance.job'

import { createDashboardRepository } from './infrastructure/repositories/dashboard.repository'
import { createMetricStatsAdapter } from './infrastructure/adapters/metric-stats.adapter'
import { createAttentionSignalsAdapter } from './infrastructure/adapters/attention-signals.adapter'
import { createFleetOverviewProjectionAdapter } from './infrastructure/adapters/fleet-overview-projection.adapter'
import { createStaffPortalResolverAdapter } from './infrastructure/adapters/staff-portal-resolver.adapter'
import { getDashboardData } from './application/use-cases/get-dashboard-data'
import type { DashboardPropertyAccess } from './application/dashboard-property-access'
import {
  getPortalAnalytics,
  type GetPortalAnalyticsDeps,
} from './portal-results/get-portal-analytics.server'
import { getPortalResultsOverview } from './application/use-cases/get-portal-results-overview'
import {
  getAttentionSignals,
  type GetAttentionSignals,
} from './application/use-cases/get-attention-signals'
import {
  getPropertyOverview,
  type GetPropertyOverview,
} from './application/use-cases/get-property-overview'
import { createReadPropertyGoogleNumbers } from './application/use-cases/read-property-google-numbers'
import { readGoogleNumbers } from './application/google-numbers-read'
import {
  getFleetOverview,
  type GetFleetOverview,
} from './application/use-cases/get-fleet-overview'
import { createPropertySetupRepository } from './infrastructure/repositories/property-setup.repository'
import {
  getPropertySetup,
  type GetPropertySetup,
} from './application/use-cases/get-property-setup'
import {
  listPropertySetupSummaries,
  type ListPropertySetupSummaries,
} from './application/use-cases/list-property-setup-summaries'

export type ReportingContextBuildInput = Readonly<{
  staffScanTargetsEnabled?: boolean
  db: Database
  clock: () => Date
  idGen: () => string
  logger: LoggerPort
  portalGroupApi: PortalGroupPublicApi
  portalApi: PortalPublicApi
  propertyApi: PropertyFactsPublicApi
  staffPublicApi: StaffPublicApi
  reviewServingStats: ReviewServingStats
  /** Review's counts and star sums of current Google reviews (rating goal). */
  reviewGoogleRatingReads: ReviewGoogleRatingReads
  inboxTargets: Pick<
    InboxPublicApi,
    'getGoogleReviewTargetCountsByProperty' | 'getReviewInboxItemIds'
  >
  guestResponseIntegrity: GetPortalAnalyticsDeps['responseIntegrity']
}>

function buildMetricModule(input: ReportingContextBuildInput) {
  const registry = createMetricRegistryRepository()
  const portalAnalytics = createPortalAnalyticsRepository(input.db, input.clock)
  const goalCorrectionImpacts = createGoalMetricCorrectionImpactLookup(input.db)
  const currentGoogleReputation = createCurrentGoogleReputationSnapshotRepository(
    input.db,
  )
  const commandStore = createAtomicMetricCommandStore(input.db, input.idGen)
  const readGoalMetric = queryGoalMetric({
    readSnapshot: createGoalMetricSnapshotReader(input.db),
    registry,
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

  const registerOutboxConsumers = (consumerRegistry: ConsumerRegistry): void => {
    registerGuestMetricConsumers(consumerRegistry, {
      recordMetrics: recordBatch,
      retractMetrics: retractBatch,
      findGroupForPortal,
    })
    registerCurrentGoogleReputationConsumer(consumerRegistry, currentGoogleReputation)
  }

  return {
    publicApi: {
      queryGoalMetric: readGoalMetric,
      queryGoalMetrics: createGoalMetricBatchReader(input.db, registry, input.clock),
      portalAnalytics,
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
    worker: Object.freeze({ registerOutboxConsumers }),
    internal: {
      repos: {} as const,
      useCases: { recordMetric: record },
    },
  } as const
}

function buildGoalModule(
  input: ReportingContextBuildInput,
  metricApi: ReturnType<typeof buildMetricModule>['publicApi'],
) {
  const goalProgramRepo = createGoalProgramRepository(input.db, input.idGen)
  const monthlyResultNotificationFacts = createMonthlyResultNotificationFactsLookup(
    input.db,
  )
  const goalProgramSubjects = createGoalProgramSubjectReader(
    input.propertyApi,
    input.portalApi,
    input.portalGroupApi,
    input.staffScanTargetsEnabled ?? false,
  )
  const goalProgramDeps = (policy: GoalExecutionPolicy) => ({
    repository: goalProgramRepo,
    policy,
    subjects: goalProgramSubjects,
    metrics: metricApi,
    id: input.idGen,
    now: input.clock,
  })
  const buildGoalPrograms = (policy: GoalExecutionPolicy) =>
    createGoalProgramService(goalProgramDeps(policy))
  const goalProgramVisibility = createGoalProgramVisibilityAdapter(
    createStaffPortalResolverAdapter(input.staffPublicApi),
    input.portalGroupApi,
  )
  const readGoalPrograms = (policy: GoalExecutionPolicy) =>
    withGoalProgramVisibility(
      buildGoalPrograms(policy),
      goalProgramVisibility,
      async (bundle, actor, propertyId) => {
        if (input.staffScanTargetsEnabled) return false
        const problems = await Promise.all(
          bundle.assignments
            .filter(
              (assignment) =>
                assignment.programVersionId === bundle.version.id &&
                (assignment.effectiveTo === null ||
                  assignment.effectiveTo > input.clock()),
            )
            .map(({ subject }) =>
              goalProgramSubjects.staffTargetProblem!(
                actor.organizationId,
                propertyId,
                subject,
                'qualified_scans',
              ),
            ),
        )
        return problems.some((problem) => problem === 'staff_scan_targets_disabled')
      },
    )
  const registerOutboxConsumers = (
    consumerRegistry: ConsumerRegistry,
    policy: GoalExecutionPolicy,
  ): void => {
    const goalPrograms = buildGoalPrograms(policy)
    registerGoalMetricCorrectionConsumer(consumerRegistry, {
      reconcile: reconcileMetricCorrection({
        findImpacts: metricApi.findGoalMetricCorrectionImpacts,
        findCandidates: goalProgramRepo.findClosedResultIdsForMetricImpact,
        reconcileClosedResult: goalPrograms.reconcileClosedResult,
      }),
      db: input.db,
    })
  }
  const goalProgressDeps = (policy: GoalExecutionPolicy) => ({
    reads: readGoalPrograms(policy),
    metrics: metricApi,
    now: input.clock,
  })
  const readGoalProgress = (policy: GoalExecutionPolicy) =>
    createGoalProgressReader(goalProgressDeps(policy))
  const readGoalProgramProgress = (policy: GoalExecutionPolicy) =>
    createGoalProgramProgressReader(goalProgressDeps(policy))
  const readGoalListProgress = (policy: GoalExecutionPolicy) =>
    createGoalListProgressReader(goalProgressDeps(policy))
  const goalRecommendationFacts: GoalRecommendationFactsPort = {
    listPortalReadiness: (organizationId, propertyId, asOf) =>
      input.portalApi.listGoalReadinessFacts(
        toOrganizationId(organizationId),
        toPropertyId(propertyId),
        asOf,
      ),
    readDailyCounts: (query) => readGoalRecommendationCounts(input.db, query),
  }
  const goalRecommendationDeps = (policy: GoalExecutionPolicy) => ({
    policy,
    subjects: goalProgramSubjects,
    facts: goalRecommendationFacts,
    now: input.clock,
  })
  const goalRecommendation: PortalGoalRecommendationRequestApi = Object.freeze({
    read: (policy, ...args) =>
      readPortalGoalRecommendation(goalRecommendationDeps(policy), ...args),
  })
  // Each use case authorizes goal.create before reading; running figures use
  // governed progress rather than recommendation counts.
  const portalGoalPrompts = createPortalGoalPromptDeferralStore(input.db)
  const monthlyPortalGoalReads = (policy: GoalExecutionPolicy) => ({
    policy,
    reads: readGoalPrograms(policy),
    metrics: metricApi,
    recommendation: goalRecommendationDeps(policy),
    prompts: portalGoalPrompts,
    now: input.clock,
  })
  const monthlyPortalGoalCommands = (policy: GoalExecutionPolicy) => ({
    policy,
    repository: goalProgramRepo,
    programs: buildGoalPrograms(policy),
    recommendation: goalRecommendationDeps(policy),
    now: input.clock,
  })
  const monthlyPortalGoal: MonthlyPortalGoalRequestApi['monthlyPortalGoal'] =
    Object.freeze({
      card: (policy, ...args) =>
        readMonthlyPortalGoalCard(monthlyPortalGoalReads(policy), ...args),
      page: (policy, ...args) =>
        readMonthlyPortalGoalPage(
          {
            ...monthlyPortalGoalReads(policy),
            history: (programId, propertyId, actor) =>
              readGoalPrograms(policy).get({ programId, propertyId }, actor),
            subjectNames: goalProgramSubjects,
            logger: input.logger,
          },
          ...args,
        ),
      set: (policy, ...args) =>
        setMonthlyPortalGoal(monthlyPortalGoalCommands(policy), ...args),
      changeNow: (policy, ...args) =>
        changeMonthlyPortalGoalNow(monthlyPortalGoalCommands(policy), ...args),
      revise: (policy, ...args) =>
        reviseMonthlyPortalGoal(monthlyPortalGoalCommands(policy), ...args),
      stop: (policy, ...args) =>
        stopMonthlyPortalGoal(monthlyPortalGoalCommands(policy), ...args),
      keep: (policy, ...args) =>
        keepMonthlyPortalGoal(monthlyPortalGoalCommands(policy), ...args),
      defer: (policy, ...args) =>
        deferMonthlyPortalGoalPrompt(
          {
            policy,
            subjects: goalProgramSubjects,
            prompts: portalGoalPrompts,
            now: input.clock,
          },
          ...args,
        ),
      line: (policy, ...args) =>
        readMonthlyPortalGoalLine(monthlyPortalGoalReads(policy), ...args),
    })
  const portalGoalAddDeps = (policy: GoalExecutionPolicy): PortalGoalAddDeps => ({
    policy,
    programs: buildGoalPrograms(policy),
    createForSubjects: (...args) =>
      createGoalsForSubjects(
        {
          ...goalProgramDeps(policy),
          subjectNames: goalProgramSubjects,
          logger: input.logger,
        },
        ...args,
      ),
    subjectNames: goalProgramSubjects,
    recommendation: goalRecommendationDeps(policy),
    now: input.clock,
  })
  const portalGoalAdd: PortalGoalAddRequestApi['portalGoalAdd'] = Object.freeze({
    options: (policy, ...args) =>
      readPortalGoalAddOptions(
        {
          policy,
          reads: readGoalPrograms(policy),
          recommendation: goalRecommendationDeps(policy),
          staffScanTargetsEnabled: input.staffScanTargetsEnabled ?? false,
          subjectNames: goalProgramSubjects,
          now: input.clock,
        },
        ...args,
      ),
    one: (policy, ...args) => addPortalGoal(portalGoalAddDeps(policy), ...args),
    each: (policy, ...args) => addPortalGoals(portalGoalAddDeps(policy), ...args),
  })
  const portalGoalSingle: PortalGoalSinglePageRequestApi['portalGoalSingle'] =
    Object.freeze({
      page: (policy, ...args) =>
        readPortalGoalSinglePage(
          {
            ...monthlyPortalGoalReads(policy),
            subjectNames: goalProgramSubjects,
            logger: input.logger,
          },
          ...args,
        ),
    })
  const programs: GoalProgramRequestApi &
    GoalProgressRequestApi &
    GoalListProgressRequestApi &
    MonthlyPortalGoalRequestApi &
    PortalGoalAddRequestApi &
    PortalGoalSinglePageRequestApi = Object.freeze({
    create: (policy, ...args) => buildGoalPrograms(policy).create(...args),
    changeStatus: (policy, ...args) => buildGoalPrograms(policy).changeStatus(...args),
    rename: (policy, ...args) => buildGoalPrograms(policy).rename(...args),
    changeMonthTarget: (policy, ...args) =>
      buildGoalPrograms(policy).changeMonthTarget(...args),
    get: (policy, ...args) => readGoalPrograms(policy).get(...args),
    list: (policy, ...args) => readGoalPrograms(policy).list(...args),
    history: (policy, ...args) => readGoalPrograms(policy).history!(...args),
    progress: (policy, ...args) => readGoalProgress(policy)(...args),
    programProgress: (policy, ...args) => readGoalProgramProgress(policy)(...args),
    listProgress: (policy, ...args) => readGoalListProgress(policy)(...args),
    monthlyPortalGoal,
    portalGoalAdd,
    portalGoalSingle,
  })

  const portalRatingGoalRead: PortalRatingGoalReadApi = {
    findPortalRatingGoalBlock: async (
      organizationId: string,
      propertyId: string,
      portalId: string,
    ) => {
      const programs = await goalProgramRepo.listSummaries(organizationId, propertyId)
      return findPortalRatingGoalBlock(programs, portalId, input.clock(), (subject) =>
        input.portalApi.listPortalRatingFacts(
          toOrganizationId(organizationId),
          toPropertyId(propertyId),
          subject,
        ),
      )
    },
  }

  return {
    publicApi: {
      programs,
      ...portalRatingGoalRead,
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
          createGoalProgramMaintenanceHandler(buildGoalPrograms(policy), input.logger),
      }),
    }),
    internal: {
      repos: { goalProgramRepo } satisfies Readonly<{
        goalProgramRepo: GoalProgramRepository
      }>,
      // Direct reads retain their own goal.create authorization.
      useCases: { goalRecommendation },
    },
  } as const
}

/** Rating goals share Goal permissions/capability, but have separate persistence. */
function buildRatingGoalModule(
  input: ReportingContextBuildInput,
  metricApi: MetricPublicApi,
) {
  const deps = {
    repository: createPropertyRatingGoalRepository(input.db),
    properties: createRatingGoalPropertyFactsReader(input.db),
    google: metricApi,
    reviews: input.reviewGoogleRatingReads,
    id: input.idGen,
    now: input.clock,
  }
  const evaluate = createRatingGoalEvaluator(deps)
  const endForArchivedProperty = createArchivedPropertyRatingGoalEnder(deps)
  return {
    publicApi: { ratingGoals: createRatingGoalRequestApi(deps) },
    worker: Object.freeze({
      registerOutboxConsumers: (consumerRegistry: ConsumerRegistry): void => {
        registerRatingGoalEvaluationConsumer(consumerRegistry, {
          evaluate,
          db: input.db,
        })
        registerRatingGoalPropertyLifecycleConsumer(consumerRegistry, {
          endForArchivedProperty,
          db: input.db,
        })
      },
      evaluation: Object.freeze({
        jobName: RATING_GOAL_EVALUATION_JOB_NAME,
        createHandler: (authorizeScope: AuthorizeRatingGoalScope) =>
          createRatingGoalEvaluationJobHandler({
            sweep: (authorize) => sweepRatingGoals(deps, authorize),
            authorizeScope,
            logger: input.logger,
          }),
      }),
    }),
  } as const
}

function buildDashboardModule(
  input: ReportingContextBuildInput,
  metricApi: MetricPublicApi,
) {
  const portalMetrics = metricApi.portalAnalytics
  const googleNumbersDeps = {
    properties: createRatingGoalPropertyFactsReader(input.db),
    google: metricApi,
  }
  const metricStats = createMetricStatsAdapter(input.db)
  const attentionSignals = createAttentionSignalsAdapter(input.db, input.clock)
  const fleetOverviewProjection = createFleetOverviewProjectionAdapter(input.db)
  const dashboardRepo = createDashboardRepository(input.reviewServingStats, metricStats)
  const propertySetupRepo = createPropertySetupRepository(input.db)
  // Identity's current grants: every Property-scoped dashboard read asks them
  // about its own reader before it reads (application/dashboard-property-access).
  const propertyAccess: DashboardPropertyAccess = (organizationId, userId, orgWide) =>
    input.staffPublicApi.getAccessiblePropertyIds(organizationId, userId, orgWide)
  const readPropertyGoogleNumbers = createReadPropertyGoogleNumbers({
    propertyAccess,
    clock: input.clock,
    readGoogleNumbers: (organizationId, propertyId, now) =>
      readGoogleNumbers(googleNumbersDeps, organizationId, propertyId, now),
  })
  const getDashboard = getDashboardData({ repo: dashboardRepo, propertyAccess })
  const getPortal = getPortalAnalytics({
    portalMetrics,
    responseIntegrity: input.guestResponseIntegrity,
    portalVersions: input.portalApi,
    propertyAccess,
  })
  const getResultsOverview = getPortalResultsOverview({
    results: createPortalResultsOverviewRepository(input.db, input.clock),
    now: input.clock,
    propertyAccess,
  })
  const getAttention: GetAttentionSignals = getAttentionSignals({
    signals: attentionSignals,
    reviewStats: input.reviewServingStats,
    inboxTargets: input.inboxTargets,
    clock: input.clock,
    propertyAccess,
  })
  const getOverview: GetPropertyOverview = getPropertyOverview({
    getDashboardData: getDashboard,
    propertyAccess,
    attention: attentionSignals,
    inboxTargets: input.inboxTargets,
    inboxItems: input.inboxTargets,
    clock: input.clock,
    googleNumbers: (organizationId, propertyId, now) =>
      readGoogleNumbers(googleNumbersDeps, organizationId, propertyId, now),
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
  const getPropertySetupRead: GetPropertySetup = getPropertySetup({
    repository: propertySetupRepo,
  })
  const listPropertySetupSummariesRead: ListPropertySetupSummaries =
    listPropertySetupSummaries({ repository: propertySetupRepo })

  return {
    publicApi: {
      staffSelf: createStaffResultsReader(
        input.db,
        input.clock,
        metricApi.queryGoalMetric,
        input.staffScanTargetsEnabled ?? false,
      ),
      readPropertyGoogleNumbers,
      getDashboardData: getDashboard,
      getPortalLinkTaps: getPortalLinkTaps({ portalMetrics, propertyAccess }),
      getPortalAnalytics: getPortal,
      getPortalResultsOverview: getResultsOverview,
      getAttentionSignals: getAttention,
      getPropertyOverview: getOverview,
      getFleetOverview: getFleet,
      getPropertySetup: getPropertySetupRead,
      listPropertySetupSummaries: listPropertySetupSummariesRead,
    },
    internal: {
      repos: { dashboardRepo, propertySetupRepo },
      useCases: {
        getDashboardData: getDashboard,
        getPortalLinkTaps: getPortalLinkTaps({ portalMetrics, propertyAccess }),
        getPortalAnalytics: getPortal,
        getPortalResultsOverview: getResultsOverview,
        getAttentionSignals: getAttention,
        getPropertyOverview: getOverview,
        getFleetOverview: getFleet,
        getPropertySetup: getPropertySetupRead,
        listPropertySetupSummaries: listPropertySetupSummariesRead,
      },
    },
  } as const
}

export function buildReportingContext(input: ReportingContextBuildInput) {
  const metric = buildMetricModule(input)
  const goal = buildGoalModule(input, metric.publicApi)
  const ratingGoal = buildRatingGoalModule(input, metric.publicApi)
  const dashboard = buildDashboardModule(input, metric.publicApi)

  return Object.freeze({
    publicApi: Object.freeze({
      ...metric.publicApi,
      ...goal.publicApi,
      ...ratingGoal.publicApi,
      ...dashboard.publicApi,
    }),
    worker: Object.freeze({
      registerOutboxConsumers: (
        consumerRegistry: ConsumerRegistry,
        goalPolicy: GoalExecutionPolicy,
      ): void => {
        metric.worker.registerOutboxConsumers(consumerRegistry)
        goal.worker.registerOutboxConsumers(consumerRegistry, goalPolicy)
        ratingGoal.worker.registerOutboxConsumers(consumerRegistry)
      },
      programMaintenance: goal.worker.programMaintenance,
      ratingGoalEvaluation: ratingGoal.worker.evaluation,
    }),
    internal: Object.freeze({
      repos: {
        ...metric.internal.repos,
        ...goal.internal.repos,
        ...dashboard.internal.repos,
      },
      useCases: {
        ...metric.internal.useCases,
        ...goal.internal.useCases,
        ...dashboard.internal.useCases,
      },
    }),
  } as const)
}
