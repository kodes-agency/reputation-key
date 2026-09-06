// Goal context — build function (composition root)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."
// Returns the public API surface of the goal context.
// Retained pre-beta CRUD is intentionally not composed here;
// the only active durable consumer reconciles GoalProgram result corrections.

import type { Database } from '#/shared/db'
import type { ConsumerRegistry } from '#/shared/outbox'
import type { MetricPublicApi } from '#/contexts/metric/application/public-api'
import type {
  PortalGroupPublicApi,
  PortalPublicApi,
} from '#/contexts/portal/application/public-api'
import type { PropertyFactsPublicApi } from '#/contexts/property/application/public-api'
import type { GoalExecutionPolicy } from './application/ports/goal-execution-policy'
import { createGoalProgramSubjectReader } from './infrastructure/adapters/goal-program-subject-reader'
import { createGoalProgramRepository } from './infrastructure/repositories/goal-program.repository'
import { createGoalProgramService } from './application/use-cases/goal-programs'
import type { GoalProgramRepository } from './application/ports/goal-program.repository'
import type { MonthlyResultNotificationFactsLookup } from './application/ports/monthly-result-notification-facts.lookup'
import { createMonthlyResultNotificationFactsLookup } from './infrastructure/adapters/monthly-result-notification-facts.lookup'
import { reconcileMetricCorrection } from './application/use-cases/reconcile-metric-correction'
import { registerGoalMetricCorrectionConsumer } from './infrastructure/metric-correction-outbox-consumers'
import {
  createGoalProgramMaintenanceHandler,
  GOAL_PROGRAM_MAINTENANCE_JOB_NAME,
} from './infrastructure/jobs/goal-program-maintenance.job'
import { createGoalOrganizationExportAdapter } from './infrastructure/adapters/goal-organization-export.adapter'
import { createGoalOrganizationLifecycleAdapter } from './infrastructure/adapters/goal-organization-lifecycle.adapter'
import type { GoalProgramRequestApi } from './application/use-cases/goal-programs'

export type GoalContextBuildInput = Readonly<{
  db: Database
  metricApi: MetricPublicApi
  clock: () => Date
  idGen: () => string
  propertyApi: PropertyFactsPublicApi
  /** Portal Group validation and current-subject expansion for Goal Programs. */
  portalGroupApi: PortalGroupPublicApi
  /** Tenant-bound Portal validation for canonical Goal Program subjects. */
  portalApi: PortalPublicApi
}>

export type GoalContextApi = Readonly<{
  publicApi: Readonly<{
    programs: GoalProgramRequestApi
    findMonthlyResultNotificationFacts: MonthlyResultNotificationFactsLookup['findMonthlyResultNotificationFacts']
    findMonthlyResultRevisionNotificationFacts: MonthlyResultNotificationFactsLookup['findMonthlyResultRevisionNotificationFacts']
  }>
  /** Context-owned worker registration; exposes no repositories or use cases. */
  worker: Readonly<{
    registerOutboxConsumers: (
      consumerRegistry: ConsumerRegistry,
      policy: GoalExecutionPolicy,
    ) => void
    programMaintenance: Readonly<{
      jobName: typeof GOAL_PROGRAM_MAINTENANCE_JOB_NAME
      createHandler: (
        policy: GoalExecutionPolicy,
      ) => ReturnType<typeof createGoalProgramMaintenanceHandler>
    }>
  }>
  /**
   * LIF-01 Organization Export contributor. Deliberately outside `publicApi`:
   * only Identity's bundle builder consumes it, and no tenant-reachable
   * surface gains a key from wiring it here.
   */
  organizationExport: ReturnType<typeof createGoalOrganizationExportAdapter>
  /**
   * LIF-01 Organization lifecycle contributor. Deliberately outside
   * `publicApi` for the same reason: only Identity's lifecycle coordinator
   * consumes it, and the coordinator itself is composed only under an
   * explicitly reviewed composition.
   */
  organizationLifecycle: ReturnType<typeof createGoalOrganizationLifecycleAdapter>
  internal: Readonly<{
    repos: Readonly<{
      goalProgramRepo: GoalProgramRepository
    }>
  }>
}>

export const buildGoalContext = (input: GoalContextBuildInput): GoalContextApi => {
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
      metrics: input.metricApi,
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
        findImpacts: input.metricApi.findGoalMetricCorrectionImpacts,
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
      repos: { goalProgramRepo },
    },
  }
}
