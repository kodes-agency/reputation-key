// The rating goal repository's writes against PostgreSQL: each is one
// compare-and-set on the version, and a failure after the row changed leaves
// nothing behind.

import { beforeEach, describe, expect, it } from 'vitest'
import type { RatingGoalChange } from '../../domain/rating-goal'
import {
  activeGoal,
  exampleWorld,
  NOW,
  PROPERTY,
  useRatingGoalDatabase,
  type FakeWorld,
} from '../testing/rating-goal-fixtures'
import { databaseRepository } from '../testing/rating-goal-database'

useRatingGoalDatabase()

let world: FakeWorld

beforeEach(() => {
  world = exampleWorld()
  world.goals = [activeGoal()]
})

const goalId = activeGoal().id

const logRow = (id: string): RatingGoalChange => ({
  id,
  goalId,
  organizationId: activeGoal().organizationId,
  propertyId: PROPERTY,
  changedBy: 'manager-1',
  changedAt: NOW,
  field: 'target',
  oldValue: '45',
  newValue: '46',
})

const planChange = (overrides: {
  expectedVersion?: number
  changes?: RatingGoalChange[]
}) =>
  ({
    organizationId: activeGoal().organizationId,
    propertyId: PROPERTY,
    goalId,
    expectedVersion: 1,
    plan: { mode: 'climb', targetTenths: 46, qualityTenths: 47, paceTenthsPerWeek: 110 },
    changes: [logRow('60000000-0000-4000-8000-000000000001')],
    changedAt: NOW,
    paceSince: activeGoal().paceSince,
    forgetsKnownStatus: true,
    ...overrides,
  }) as const

describe('changing the plan', () => {
  it('moves the version and logs the change together', async () => {
    const repository = databaseRepository(world)

    await expect(repository.changePlan(planChange({}))).resolves.toBe('written')

    expect(world.goals[0]).toMatchObject({ targetTenths: 46, version: 2 })
    expect(world.changes).toHaveLength(1)
  })

  it('leaves the goal as it was when the log cannot be written', async () => {
    const repository = databaseRepository(world)
    const twice = logRow('60000000-0000-4000-8000-000000000002')

    await expect(
      repository.changePlan(planChange({ changes: [twice, twice] })),
    ).rejects.toMatchObject({ cause: { code: '23505' } })

    // The failed call rolled back to the savepoint the helper reads from.
    expect(world.goals[0]).toMatchObject({ targetTenths: 45, version: 1 })
    expect(world.changes).toEqual([])
  })

  it('lets only one of two forms opened on the same version through', async () => {
    const repository = databaseRepository(world)

    const first = await repository.changePlan(planChange({}))
    const second = await repository.changePlan(
      planChange({ changes: [logRow('60000000-0000-4000-8000-000000000003')] }),
    )

    expect([first, second]).toEqual(['written', 'version_conflict'])
    expect(world.goals[0]!.version).toBe(2)
    expect(world.changes).toHaveLength(1)
  })

  it('refuses a goal that is no longer active, whatever the version', async () => {
    world.goals = [activeGoal({ state: 'ended', endedReason: 'manager', endedAt: NOW })]
    const repository = databaseRepository(world)

    await expect(repository.changePlan(planChange({}))).resolves.toBe('not_active')
    expect(world.changes).toEqual([])
  })
})

describe('ending a goal', () => {
  const end = {
    organizationId: activeGoal().organizationId,
    propertyId: PROPERTY,
    goalId,
    endedAt: NOW,
  }

  it('does not end a goal whose plan changed since the form opened', async () => {
    const repository = databaseRepository(world)
    await repository.changePlan(planChange({}))

    await expect(repository.endByManager({ ...end, expectedVersion: 1 })).resolves.toBe(
      'version_conflict',
    )
    expect(world.goals[0]).toMatchObject({ state: 'active', version: 2 })
  })

  it('ends it once, then reports it is not active', async () => {
    const repository = databaseRepository(world)

    const first = await repository.endByManager({ ...end, expectedVersion: 1 })
    const second = await repository.endByManager({ ...end, expectedVersion: 2 })

    expect([first, second]).toEqual(['written', 'not_active'])
    expect(world.goals[0]).toMatchObject({ state: 'ended', endedReason: 'manager' })
  })
})
