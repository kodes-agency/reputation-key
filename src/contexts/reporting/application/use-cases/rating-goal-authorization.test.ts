// Every Property Google rating goal use case asks the Goal policy for its own
// action on the Property before it reads or writes anything, and a refusal
// stops it there (ADR 0049 permissions, `goal.use`, PropertyAccessGrant).
// Removing `authorizeRatingGoal` from any one of them fails this table.

import { beforeEach, describe, expect, it } from 'vitest'
import type { RatingGoalDependencies } from './rating-goal-shared'
import {
  actor,
  activeGoal,
  dependencies,
  exampleWorld,
  PROPERTY,
  type FakeWorld,
} from './rating-goal-test-fixtures'
import { changeRatingGoal, endRatingGoal, setRatingGoal } from './rating-goal-commands'
import {
  getRatingGoalCard,
  getRatingGoalDetail,
  getRatingGoalHistory,
  getRatingGoalSetup,
} from './rating-goal-reads'

type UseCaseRow = Readonly<{
  name: string
  action: 'goal.read' | 'goal.create' | 'goal.update' | 'goal.cancel'
  /** Whether the Property already has an active goal for this use case to act on. */
  withActiveGoal: boolean
  run: (deps: RatingGoalDependencies) => Promise<unknown>
}>

const goalRef = { propertyId: PROPERTY, goalId: activeGoal().id, expectedVersion: 1 }

const USE_CASES: readonly UseCaseRow[] = [
  {
    name: 'getRatingGoalSetup',
    action: 'goal.read',
    withActiveGoal: false,
    run: (deps) => getRatingGoalSetup(deps, { propertyId: PROPERTY }, actor),
  },
  {
    name: 'getRatingGoalCard',
    action: 'goal.read',
    withActiveGoal: true,
    run: (deps) => getRatingGoalCard(deps, { propertyId: PROPERTY }, actor),
  },
  {
    name: 'getRatingGoalDetail',
    action: 'goal.read',
    withActiveGoal: true,
    run: (deps) => getRatingGoalDetail(deps, { propertyId: PROPERTY }, actor),
  },
  {
    name: 'getRatingGoalHistory',
    action: 'goal.read',
    withActiveGoal: true,
    run: (deps) => getRatingGoalHistory(deps, { propertyId: PROPERTY }, actor),
  },
  {
    name: 'setRatingGoal',
    action: 'goal.create',
    withActiveGoal: false,
    run: (deps) =>
      setRatingGoal(
        deps,
        {
          propertyId: PROPERTY,
          mode: 'climb',
          targetTenths: 44,
          qualityTenths: 47,
          paceTenthsPerWeek: 110,
        },
        actor,
      ),
  },
  {
    name: 'changeRatingGoal',
    action: 'goal.update',
    withActiveGoal: true,
    run: (deps) => changeRatingGoal(deps, { ...goalRef, targetTenths: 46 }, actor),
  },
  {
    name: 'endRatingGoal',
    action: 'goal.cancel',
    withActiveGoal: true,
    run: (deps) => endRatingGoal(deps, goalRef, actor),
  },
]

let world: FakeWorld

beforeEach(() => {
  world = exampleWorld()
})

describe.each(USE_CASES)('$name', ({ action, withActiveGoal, run }) => {
  beforeEach(() => {
    world.goals = withActiveGoal ? [activeGoal()] : []
  })

  it(`asks for ${action} on the Property before any read or write`, async () => {
    await run(dependencies(world))

    expect(world.authorizations).toEqual([`${action}:${PROPERTY}`])
    expect(world.calls[0]).toBe('policy.authorize')
    expect(world.calls.filter((call) => call === 'policy.authorize')).toHaveLength(1)
  })

  it('reads and writes nothing when the policy refuses', async () => {
    const before = world.goals
    world.deny = true

    await expect(run(dependencies(world))).rejects.toThrow(/denied by policy/u)

    expect(world.authorizations).toEqual([`${action}:${PROPERTY}`])
    expect(world.calls).toEqual(['policy.authorize'])
    expect(world.goals).toBe(before)
    expect(world.changes).toEqual([])
  })
})
