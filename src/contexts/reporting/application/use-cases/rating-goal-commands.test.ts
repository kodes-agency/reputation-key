import { beforeEach, describe, expect, it } from 'vitest'
import {
  actor,
  activeGoal,
  dependencies,
  exampleWorld,
  NOW,
  PROPERTY,
  type FakeWorld,
} from './rating-goal-test-fixtures'
import { changeRatingGoal, endRatingGoal, setRatingGoal } from './rating-goal-commands'

let world: FakeWorld

beforeEach(() => {
  world = exampleWorld()
})

const climb = {
  propertyId: PROPERTY,
  mode: 'climb',
  targetTenths: 44,
  pacePerWeek: 11,
} as const

describe('setting a rating goal', () => {
  it('stores the plan, the binding epoch and the baselines it starts from', async () => {
    const result = await setRatingGoal(dependencies(world), climb, actor)

    expect(result).toEqual({ goalId: world.goals[0]!.id, version: 1 })
    expect(world.goals[0]).toMatchObject({
      organizationId: actor.organizationId,
      propertyId: PROPERTY,
      sourceEpoch: 2,
      mode: 'climb',
      targetTenths: 44,
      pacePerWeek: 11,
      state: 'active',
      createdBy: 'manager-1',
      createdAt: NOW,
      baseline: { reviewCount: 812, googleAverage: 4.300000190734863 },
    })
    expect(world.goals[0]!.baseline.exactAverage).toBeCloseTo(3500 / 812, 10)
  })

  it.each([
    ['a climb in reach', { targetTenths: 44 }, 'getting_started'],
    // 4.8 starts at 4.75, above the 4.70 recent mix: no pace gets there.
    ['a climb past the recent mix', { targetTenths: 48 }, 'cant_reach_at_mix'],
    ['a keep goal', { mode: 'keep', targetTenths: 43, pacePerWeek: null }, 'holding'],
  ] as const)(
    'stores the tenth Google shows and the status %s starts in, as known',
    async (_name, plan, status) => {
      await setRatingGoal(dependencies(world), { ...climb, ...plan }, actor)

      // The first evaluation can then tell a tenth gained or lost since it was
      // set, and a status entered since, without a notice for where it began.
      expect(world.goals[0]!.lastEvaluation).toEqual({
        displayedTenths: 43,
        status,
        evaluatedAt: NOW,
        knownStatus: status,
        belowPaceNoticedAt: null,
      })
    },
  )

  it('asks the policy for goal.create on the Property before reading anything', async () => {
    world.deny = true

    await expect(setRatingGoal(dependencies(world), climb, actor)).rejects.toThrow(
      /denied by policy/u,
    )
    expect(world.authorizations).toEqual([`goal.create:${PROPERTY}`])
    expect(world.summaryRequests).toEqual([])
    expect(world.goals).toEqual([])
  })

  it('refuses a second active goal on the Property', async () => {
    world.goals = [activeGoal()]

    await expect(setRatingGoal(dependencies(world), climb, actor)).rejects.toMatchObject({
      code: 'goal_exists',
    })
  })

  it('refuses a Property with fewer than ten Google reviews', async () => {
    world.snapshot = { ...world.snapshot!, reviewCount: 6 }

    await expect(setRatingGoal(dependencies(world), climb, actor)).rejects.toMatchObject({
      code: 'not_eligible',
      context: { reason: 'few_reviews' },
    })
  })

  it('refuses a Property without a Google review as having too few', async () => {
    world.snapshot = { ...world.snapshot!, reviewCount: 0, averageRating: null }
    world.summary = {
      ...world.summary,
      all: { count: 0, sum: 0 },
      mixWindow: { count: 0, sum: 0 },
      mostRecent: { count: 0, sum: 0 },
    }

    await expect(setRatingGoal(dependencies(world), climb, actor)).rejects.toMatchObject({
      code: 'not_eligible',
      context: { reason: 'few_reviews' },
    })
  })

  it('refuses while Google numbers are more than a day old', async () => {
    world.snapshot = {
      ...world.snapshot!,
      verifiedAt: new Date(NOW.getTime() - 25 * 3600_000),
    }

    await expect(setRatingGoal(dependencies(world), climb, actor)).rejects.toMatchObject({
      code: 'not_eligible',
      context: { reason: 'waiting_for_google' },
    })
  })

  it('refuses a climb to what Google already shows, and 5.0', async () => {
    for (const targetTenths of [43, 50]) {
      await expect(
        setRatingGoal(dependencies(world), { ...climb, targetTenths }, actor),
      ).rejects.toMatchObject({ code: 'invalid_target' })
    }
  })

  it('keeps a tenth Google shows without a pace', async () => {
    await setRatingGoal(
      dependencies(world),
      { propertyId: PROPERTY, mode: 'keep', targetTenths: 43, pacePerWeek: null },
      actor,
    )

    expect(world.goals[0]).toMatchObject({
      mode: 'keep',
      targetTenths: 43,
      pacePerWeek: null,
    })
  })

  it('sets nothing while the Organization closure holds it', async () => {
    world.held = true

    await expect(setRatingGoal(dependencies(world), climb, actor)).rejects.toMatchObject({
      code: 'organization_closing',
    })
  })

  it('sets nothing for an archived or suspended Property', async () => {
    for (const lifecycleState of ['archived', 'suspended']) {
      world.facts = { ...world.facts!, lifecycleState }

      await expect(
        setRatingGoal(dependencies(world), climb, actor),
      ).rejects.toMatchObject({
        code: 'not_eligible',
        context: { reason: 'property_not_active' },
      })
    }
  })
})

describe('changing a rating goal', () => {
  const change = { propertyId: PROPERTY, goalId: activeGoal().id, expectedVersion: 1 }

  beforeEach(() => {
    world.goals = [activeGoal()]
  })

  it('logs each changed field with who and when, and moves the version', async () => {
    const result = await changeRatingGoal(
      dependencies(world),
      { ...change, targetTenths: 46, pacePerWeek: 14 },
      actor,
    )

    expect(result).toEqual({ goalId: change.goalId, version: 2 })
    expect(world.goals[0]).toMatchObject({
      targetTenths: 46,
      pacePerWeek: 14,
      version: 2,
    })
    expect(
      world.changes.map(({ field, oldValue, newValue, changedBy, changedAt }) => ({
        field,
        oldValue,
        newValue,
        changedBy,
        changedAt,
      })),
    ).toEqual([
      {
        field: 'target',
        oldValue: '45',
        newValue: '46',
        changedBy: 'manager-1',
        changedAt: NOW,
      },
      {
        field: 'pace',
        oldValue: '11',
        newValue: '14',
        changedBy: 'manager-1',
        changedAt: NOW,
      },
    ])
    expect(world.authorizations).toEqual([`goal.update:${PROPERTY}`])
  })

  it('changes a pace without asking Google again', async () => {
    world.snapshot = null

    await changeRatingGoal(dependencies(world), { ...change, pacePerWeek: 7 }, actor)

    expect(world.goals[0]!.pacePerWeek).toBe(7)
    expect(world.summaryRequests).toEqual([])
  })

  it('drops the pace when the goal switches to keep', async () => {
    await changeRatingGoal(
      dependencies(world),
      { ...change, mode: 'keep', targetTenths: 43 },
      actor,
    )

    expect(world.goals[0]).toMatchObject({
      mode: 'keep',
      targetTenths: 43,
      pacePerWeek: null,
    })
    expect(world.changes.map((row) => row.field)).toEqual(['mode', 'target', 'pace'])
  })

  it('refuses a form opened on an older version', async () => {
    await expect(
      changeRatingGoal(
        dependencies(world),
        { ...change, expectedVersion: 2, pacePerWeek: 7 },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'version_conflict' })
  })

  it('refuses a goal that was reached', async () => {
    world.goals = [activeGoal({ state: 'reached', reachedAt: NOW })]

    await expect(
      changeRatingGoal(dependencies(world), { ...change, pacePerWeek: 7 }, actor),
    ).rejects.toMatchObject({ code: 'not_active' })
  })

  it('refuses a change that changes nothing, and a pace out of range', async () => {
    await expect(
      changeRatingGoal(dependencies(world), { ...change, pacePerWeek: 11 }, actor),
    ).rejects.toMatchObject({ code: 'no_change' })
    await expect(
      changeRatingGoal(dependencies(world), { ...change, pacePerWeek: 201 }, actor),
    ).rejects.toMatchObject({ code: 'invalid_pace' })
  })

  it('answers not found for a goal of another Property', async () => {
    await expect(
      changeRatingGoal(
        dependencies(world),
        { ...change, propertyId: '30000000-0000-4000-8000-000000000099', pacePerWeek: 7 },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('ending a rating goal', () => {
  beforeEach(() => {
    world.goals = [activeGoal()]
  })

  it('ends it as the manager’s decision, under goal.cancel', async () => {
    const result = await endRatingGoal(
      dependencies(world),
      { propertyId: PROPERTY, goalId: activeGoal().id, expectedVersion: 1 },
      actor,
    )

    expect(result).toEqual({ goalId: activeGoal().id, ended: true })
    expect(world.goals[0]).toMatchObject({
      state: 'ended',
      endedReason: 'manager',
      endedAt: NOW,
    })
    expect(world.authorizations).toEqual([`goal.cancel:${PROPERTY}`])
  })
})
