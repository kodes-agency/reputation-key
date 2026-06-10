// Goal context — build function (composition root)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."
// Returns the public API surface of the goal context.
// Also registers event handlers on the shared EventBus so that every process
// (web server + worker) handles metric.recorded etc. without needing a
// separate bootstrap() call.

import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { MetricPublicApi } from '#/contexts/metric/application/public-api'
import type { GoalRepository } from './application/ports/goal.repository'
import type { CancelGoalFn } from './infrastructure/event-handlers'
import type { getLogger as getLoggerType } from '#/shared/observability/logger'
import { createGoalRepository } from './infrastructure/repositories/goal.repository'
import { createGoal } from './application/use-cases/create-goal'
import { updateGoal } from './application/use-cases/update-goal'
import { cancelGoal } from './application/use-cases/cancel-goal'
import { listGoals } from './application/use-cases/list-goals'
import { getGoal } from './application/use-cases/get-goal'
import { registerGoalEventHandlers } from './infrastructure/event-handlers'

export type GoalContextBuildInput = Readonly<{
  db: Database
  metricApi: MetricPublicApi
  events: EventBus
  clock: () => Date
  idGen: () => string
  cancelGoalFn: CancelGoalFn
  getLogger: typeof getLoggerType
  findGroupForPortal: (
    orgId: import('#/shared/domain/ids').OrganizationId,
    portalId: import('#/shared/domain/ids').PortalId,
  ) => Promise<{ portalGroupId: import('#/shared/domain/ids').PortalGroupId } | null>
}>

export type GoalContextApi = Readonly<{
  useCases: {
    createGoal: ReturnType<typeof createGoal>
    updateGoal: ReturnType<typeof updateGoal>
    cancelGoal: ReturnType<typeof cancelGoal>
    listGoals: ReturnType<typeof listGoals>
    getGoal: ReturnType<typeof getGoal>
  }
  goalRepo: GoalRepository
  events: EventBus
  publicApi: Readonly<{
    createGoal: ReturnType<typeof createGoal>
    updateGoal: ReturnType<typeof updateGoal>
    cancelGoal: ReturnType<typeof cancelGoal>
    listGoals: ReturnType<typeof listGoals>
    getGoal: ReturnType<typeof getGoal>
  }>
}>

export const buildGoalContext = (input: GoalContextBuildInput): GoalContextApi => {
  const goalRepo = createGoalRepository(input.db)

  const _createGoal = createGoal({
    goalRepo,
    metricRepo: input.metricApi,
    idGen: input.idGen,
    clock: input.clock,
  })

  const _updateGoal = updateGoal({
    goalRepo,
    clock: input.clock,
  })

  const _cancelGoal = cancelGoal({
    goalRepo,
    clock: input.clock,
  })

  const _listGoals = listGoals({
    goalRepo,
  })

  const _getGoal = getGoal({
    goalRepo,
  })

  // Register event handlers (metric.recorded, portal_group.deleted, etc.)
  // Per architecture: handlers are registered at build time so every process
  // (web server + worker) handles events without a separate bootstrap() call.
  registerGoalEventHandlers({
    eventBus: input.events,
    goalRepo,
    cancelGoalFn: input.cancelGoalFn,
    clock: input.clock,
    getLogger: input.getLogger,
    findGroupForPortal: input.findGroupForPortal,
  })

  return {
    useCases: {
      createGoal: _createGoal,
      updateGoal: _updateGoal,
      cancelGoal: _cancelGoal,
      listGoals: _listGoals,
      getGoal: _getGoal,
    },
    goalRepo,
    events: input.events,
    publicApi: {
      createGoal: _createGoal,
      updateGoal: _updateGoal,
      cancelGoal: _cancelGoal,
      listGoals: _listGoals,
      getGoal: _getGoal,
    },
  }
}
