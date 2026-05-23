// Goal context — build function (composition root)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."
// Returns the public API surface of the goal context.

import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { MetricPublicApi } from '#/contexts/metric/application/public-api'
import type { GoalRepository } from './application/ports/goal.repository'
import { createGoalRepository } from './infrastructure/repositories/goal.repository'
import { createGoal } from './application/use-cases/create-goal'
import { updateGoal } from './application/use-cases/update-goal'
import { cancelGoal } from './application/use-cases/cancel-goal'
import { listGoals } from './application/use-cases/list-goals'
import { getGoal } from './application/use-cases/get-goal'

export type GoalContextBuildInput = Readonly<{
  db: Database
  metricApi: MetricPublicApi
  events: EventBus
  clock: () => Date
  idGen: () => string
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
  }
}
