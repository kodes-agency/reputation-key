// Goal context — build function (composition root)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."
// Returns the public API surface of the goal context.
// Also registers event handlers on the shared EventBus so that every process
// (web server + worker) handles metric.recorded etc. without needing a
// separate bootstrap() call.

import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { MetricPublicApi } from '#/contexts/metric/application/public-api'
import type { PortalGroupPublicApi } from '#/contexts/portal/application/public-api'
import type { GoalRepository } from './application/ports/goal.repository'
import type { getLogger as getLoggerType } from '#/shared/observability/logger'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { PropertyFactsPublicApi } from '#/contexts/property/application/public-api'
import { createGoalRepository } from './infrastructure/repositories/goal.repository'
import { createGovernedGoalRepository } from './infrastructure/repositories/governed-goal.repository'
import {
  createGovernedGoalService,
  type GoalExecutionPolicy,
  type GovernedGoalService,
} from './application/use-cases/governed-goals'
import type { GovernedGoalRepository } from './application/ports/governed-goal.repository'
import { createGovernedGoalPropertyReader } from './infrastructure/adapters/governed-goal-property-reader'
import { createGoal } from './application/use-cases/create-goal'
import { updateGoal } from './application/use-cases/update-goal'
import { cancelGoal } from './application/use-cases/cancel-goal'
import { listGoals } from './application/use-cases/list-goals'
import { getGoal } from './application/use-cases/get-goal'
import {
  listStaffGoals,
  type PortalGroupLookupPort,
  type ListStaffGoals,
} from './application/use-cases/list-staff-goals'

export type GoalContextBuildInput = Readonly<{
  db: Database
  metricApi: MetricPublicApi
  events: EventBus
  outboxRepo?: import('#/shared/outbox').OutboxRepository
  clock: () => Date
  idGen: () => string
  staffPublicApi: StaffPublicApi
  propertyApi: PropertyFactsPublicApi
  getLogger: typeof getLoggerType
  /** Portal group resolution for staff-goal visibility. */
  portalGroupApi: PortalGroupPublicApi
}>

export type GoalContextApi = Readonly<{
  publicApi: Readonly<{
    createGoal: ReturnType<typeof createGoal>
    updateGoal: ReturnType<typeof updateGoal>
    cancelGoal: ReturnType<typeof cancelGoal>
    listGoals: ReturnType<typeof listGoals>
    getGoal: ReturnType<typeof getGoal>
  }>
  internal: Readonly<{
    repos: Readonly<{
      goalRepo: GoalRepository
      governedGoalRepo: GovernedGoalRepository
    }>
    useCases: Readonly<{
      createGoal: ReturnType<typeof createGoal>
      updateGoal: ReturnType<typeof updateGoal>
      cancelGoal: ReturnType<typeof cancelGoal>
      listGoals: ReturnType<typeof listGoals>
      getGoal: ReturnType<typeof getGoal>
      listStaffGoals: ListStaffGoals
      createGovernedGoalService: (policy: GoalExecutionPolicy) => GovernedGoalService
    }>
    events: EventBus
  }>
}>

export const buildGoalContext = (input: GoalContextBuildInput): GoalContextApi => {
  const goalRepo = createGoalRepository(input.db)
  const governedGoalRepo = createGovernedGoalRepository(input.db)

  // Resolve portal group IDs for a batch of portal IDs (staff goals visibility).
  const portalGroupLookup: PortalGroupLookupPort = {
    findGroupIdsByPortalIds: (orgId, portalIds) =>
      input.portalGroupApi.findGroupIdsByPortalIds(orgId, portalIds),
  }

  const _createGoal = createGoal({
    goalRepo,
    metricRepo: input.metricApi,
    staffPublicApi: input.staffPublicApi,
    idGen: input.idGen,
    clock: input.clock,
  })

  const _updateGoal = updateGoal({
    goalRepo,
    staffPublicApi: input.staffPublicApi,
    clock: input.clock,
  })

  const _cancelGoal = cancelGoal({
    goalRepo,
    staffPublicApi: input.staffPublicApi,
    clock: input.clock,
  })

  const _listGoals = listGoals({
    goalRepo,
    staffPublicApi: input.staffPublicApi,
  })

  const _getGoal = getGoal({
    goalRepo,
    staffPublicApi: input.staffPublicApi,
  })

  const _listStaffGoals = listStaffGoals({
    goalRepo,
    staffPublicApi: input.staffPublicApi,
    portalGroupLookup,
  })

  const governedProperties = createGovernedGoalPropertyReader(
    input.propertyApi,
    input.portalGroupApi,
  )

  const buildGovernedService = (policy: GoalExecutionPolicy) =>
    createGovernedGoalService({
      repository: governedGoalRepo,
      policy,
      properties: governedProperties,
      metrics: {
        getApprovedVersion: async (versionId) => {
          const governed = await input.metricApi.getApprovedGoalVersion?.(versionId)
          if (!governed) return null
          return {
            definitionId: governed.definition.id,
            versionId: governed.version.id,
            metricKey: governed.definition.key,
            valueKind: governed.definition.valueKind,
            allowedScopes: governed.version.allowedScopes,
            sourcePolicyAllowlist: governed.version.sourcePolicyAllowlist,
            permittedConsumers: governed.version.permittedConsumers,
            minimumSample: governed.version.minimumSample,
            employmentDecisionEligible: governed.version.employmentDecisionEligible,
          }
        },
      },
      id: input.idGen,
      now: input.clock,
    })

  return {
    publicApi: {
      createGoal: _createGoal,
      updateGoal: _updateGoal,
      cancelGoal: _cancelGoal,
      listGoals: _listGoals,
      getGoal: _getGoal,
    },
    internal: {
      repos: { goalRepo, governedGoalRepo },
      useCases: {
        createGoal: _createGoal,
        updateGoal: _updateGoal,
        cancelGoal: _cancelGoal,
        listGoals: _listGoals,
        getGoal: _getGoal,
        listStaffGoals: _listStaffGoals,
        createGovernedGoalService: buildGovernedService,
      },
      events: input.events,
    },
  }
}
