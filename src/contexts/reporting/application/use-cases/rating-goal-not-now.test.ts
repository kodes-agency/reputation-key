import { beforeEach, describe, expect, it } from 'vitest'
import {
  actor,
  dependencies,
  exampleWorld,
  NOW,
  PROPERTY,
  type FakeWorld,
} from './rating-goal-test-fixtures'
import { deferRatingGoal } from './rating-goal-not-now'

let world: FakeWorld

beforeEach(() => {
  world = exampleWorld()
})

describe('choosing "Not now" for a rating goal', () => {
  it('records who chose it and when, for the Property', async () => {
    // Act
    const result = await deferRatingGoal(
      dependencies(world),
      { propertyId: PROPERTY },
      actor,
    )

    // Assert
    expect(result).toEqual({ propertyId: PROPERTY })
    expect(world.notNow).toEqual([
      {
        organizationId: actor.organizationId,
        propertyId: PROPERTY,
        chosenBy: actor.userId,
        chosenAt: NOW,
      },
    ])
  })

  it('asks the Goal policy for goal.create on the Property before anything is read', async () => {
    // Act
    await deferRatingGoal(dependencies(world), { propertyId: PROPERTY }, actor)

    // Assert
    expect(world.authorizations).toEqual([`goal.create:${PROPERTY}`])
    expect(world.calls[0]).toBe('policy.authorize')
  })

  it('records nothing when the policy refuses', async () => {
    // Arrange
    world.deny = true

    // Act / Assert
    await expect(
      deferRatingGoal(dependencies(world), { propertyId: PROPERTY }, actor),
    ).rejects.toThrow('denied by policy')
    expect(world.notNow).toEqual([])
    expect(world.calls).toEqual(['policy.authorize'])
  })

  it('refuses a Property that is not the Organization’s, as not found', async () => {
    // Arrange
    world.facts = null

    // Act / Assert
    await expect(
      deferRatingGoal(dependencies(world), { propertyId: PROPERTY }, actor),
    ).rejects.toMatchObject({ _tag: 'RatingGoalError', code: 'not_found' })
    expect(world.notNow).toEqual([])
  })

  it('keeps the first choice when "Not now" is chosen again', async () => {
    // Arrange
    const deps = dependencies(world)
    await deferRatingGoal(deps, { propertyId: PROPERTY }, actor)

    // Act
    const again = await deferRatingGoal(
      deps,
      { propertyId: PROPERTY },
      { ...actor, userId: 'manager-2' },
    )

    // Assert
    expect(again).toEqual({ propertyId: PROPERTY })
    expect(world.notNow).toHaveLength(1)
    expect(world.notNow[0]?.chosenBy).toBe(actor.userId)
  })
})
