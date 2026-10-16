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
  qualityTenths: 47,
  paceTenthsPerWeek: 110,
} as const

const keep49 = {
  propertyId: PROPERTY,
  mode: 'keep',
  targetTenths: 49,
  qualityTenths: null,
  paceTenthsPerWeek: null,
} as const

/** Google shows 4.9 (3980 / 812 = 4.9015): the only numbers Keep is set at (R2-9). */
function showingFourNine(at: FakeWorld): void {
  at.snapshot = { ...at.snapshot!, averageRating: Math.fround(4.9) }
  at.summary = { ...at.summary, all: { count: 812, sum: 3980 } }
}

describe('setting a rating goal', () => {
  it('takes a planned quality exactly at the target’s floor and a pace of 1.5 a day', async () => {
    // 4.4 needs new reviews at 4.5 or more; 1.5 a day is 105 tenths a week.
    await setRatingGoal(
      dependencies(world),
      { ...climb, qualityTenths: 45, paceTenthsPerWeek: 105 },
      actor,
    )

    expect(world.goals[0]).toMatchObject({ qualityTenths: 45, paceTenthsPerWeek: 105 })
  })

  it('stores the plan, the binding epoch and the baselines it starts from', async () => {
    const result = await setRatingGoal(dependencies(world), climb, actor)

    expect(result).toEqual({ goalId: world.goals[0]!.id, version: 1 })
    expect(world.goals[0]).toMatchObject({
      organizationId: actor.organizationId,
      propertyId: PROPERTY,
      sourceEpoch: 2,
      mode: 'climb',
      targetTenths: 44,
      qualityTenths: 47,
      paceTenthsPerWeek: 110,
      state: 'active',
      createdBy: 'manager-1',
      createdAt: NOW,
      baseline: { reviewCount: 812, googleAverage: 4.300000190734863 },
    })
    expect(world.goals[0]!.baseline.exactAverage).toBeCloseTo(3500 / 812, 10)
  })

  it.each([
    ['a climb in reach', { targetTenths: 44 }, 'getting_started'],
    // 4.8 starts at 4.75, above the 4.70 recent mix, but a plan judges the
    // reviews that arrive after it is set, and none has yet.
    [
      'a climb past the recent mix',
      { targetTenths: 48, qualityTenths: 50 },
      'getting_started',
    ],
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
        tooLowNoticedAt: null,
      })
    },
  )

  it('stores the tenth Google shows and the status a keep goal starts in, as known', async () => {
    showingFourNine(world)

    await setRatingGoal(dependencies(world), keep49, actor)

    expect(world.goals[0]!.lastEvaluation).toMatchObject({
      displayedTenths: 49,
      status: 'holding',
      knownStatus: 'holding',
    })
  })

  it('refuses a planned quality that does not clear the target’s floor by 0.15★', async () => {
    // 4.4 shows from 4.35, so new reviews must average 4.5 or more.
    await expect(
      setRatingGoal(dependencies(world), { ...climb, qualityTenths: 44 }, actor),
    ).rejects.toMatchObject({ code: 'invalid_quality' })
    await expect(
      setRatingGoal(dependencies(world), { ...climb, qualityTenths: null }, actor),
    ).rejects.toMatchObject({ code: 'invalid_quality' })
    expect(world.goals).toEqual([])
  })

  it('refuses a planned quality on a keep goal', async () => {
    showingFourNine(world)

    await expect(
      setRatingGoal(dependencies(world), { ...keep49, qualityTenths: 47 }, actor),
    ).rejects.toMatchObject({ code: 'invalid_quality' })
  })

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
    showingFourNine(world)

    await setRatingGoal(dependencies(world), keep49, actor)

    expect(world.goals[0]).toMatchObject({
      mode: 'keep',
      targetTenths: 49,
      qualityTenths: null,
      paceTenthsPerWeek: null,
    })
  })

  it('keeps 4.7 once Google shows it (X1: Keep first from 4.7)', async () => {
    world.snapshot = { ...world.snapshot!, averageRating: Math.fround(4.7) }
    world.summary = { ...world.summary, all: { count: 812, sum: 3817 } }

    await setRatingGoal(dependencies(world), { ...keep49, targetTenths: 47 }, actor)

    expect(world.goals).toMatchObject([{ mode: 'keep', targetTenths: 47 }])
  })

  it('keeps nothing while Google shows less than 4.7', async () => {
    await expect(
      setRatingGoal(dependencies(world), { ...keep49, targetTenths: 43 }, actor),
    ).rejects.toMatchObject({ code: 'invalid_target' })
    expect(world.goals).toEqual([])
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
      { ...change, targetTenths: 46, paceTenthsPerWeek: 140 },
      actor,
    )

    expect(result).toEqual({ goalId: change.goalId, version: 2 })
    expect(world.goals[0]).toMatchObject({
      targetTenths: 46,
      paceTenthsPerWeek: 140,
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
        oldValue: '110',
        newValue: '140',
        changedBy: 'manager-1',
        changedAt: NOW,
      },
    ])
    expect(world.authorizations).toEqual([`goal.update:${PROPERTY}`])
  })

  it('changes the planned quality alone, logged, without asking Google again', async () => {
    world.snapshot = null

    const result = await changeRatingGoal(
      dependencies(world),
      { ...change, qualityTenths: 48 },
      actor,
    )

    expect(result.version).toBe(2)
    expect(world.goals[0]!.qualityTenths).toBe(48)
    expect(
      world.changes.map(({ field, oldValue, newValue }) => [field, oldValue, newValue]),
    ).toEqual([['quality', '47', '48']])
    expect(world.summaryRequests).toEqual([])
  })

  it('refuses a target the kept quality no longer clears by 0.15★', async () => {
    // 4.7 needs new reviews at 4.8 or more; the goal plans 4.7.
    await expect(
      changeRatingGoal(dependencies(world), { ...change, targetTenths: 47 }, actor),
    ).rejects.toMatchObject({ code: 'invalid_quality' })
    expect(world.changes).toEqual([])
  })

  it('changes a pace without asking Google again', async () => {
    world.snapshot = null

    await changeRatingGoal(
      dependencies(world),
      { ...change, paceTenthsPerWeek: 70 },
      actor,
    )

    expect(world.goals[0]!.paceTenthsPerWeek).toBe(70)
    expect(world.summaryRequests).toEqual([])
  })

  it('drops the quality and the pace when the goal switches to keep', async () => {
    showingFourNine(world)

    await changeRatingGoal(
      dependencies(world),
      { ...change, mode: 'keep', targetTenths: 49 },
      actor,
    )

    expect(world.goals[0]).toMatchObject({
      mode: 'keep',
      targetTenths: 49,
      qualityTenths: null,
      paceTenthsPerWeek: null,
    })
    expect(world.changes.map((row) => row.field)).toEqual([
      'mode',
      'target',
      'quality',
      'pace',
    ])
  })

  it('needs a planned quality to switch a keep goal to climb', async () => {
    world.goals = [
      activeGoal({
        mode: 'keep',
        targetTenths: 43,
        qualityTenths: null,
        paceTenthsPerWeek: null,
      }),
    ]

    await expect(
      changeRatingGoal(
        dependencies(world),
        { ...change, mode: 'climb', targetTenths: 44, paceTenthsPerWeek: 110 },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'invalid_quality' })
    await changeRatingGoal(
      dependencies(world),
      {
        ...change,
        mode: 'climb',
        targetTenths: 44,
        qualityTenths: 47,
        paceTenthsPerWeek: 110,
      },
      actor,
    )

    expect(world.goals[0]).toMatchObject({ mode: 'climb', qualityTenths: 47 })
  })

  it('refuses a form opened on an older version', async () => {
    await expect(
      changeRatingGoal(
        dependencies(world),
        { ...change, expectedVersion: 2, paceTenthsPerWeek: 70 },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'version_conflict' })
  })

  it('refuses a goal that was reached', async () => {
    world.goals = [activeGoal({ state: 'reached', reachedAt: NOW })]

    await expect(
      changeRatingGoal(dependencies(world), { ...change, paceTenthsPerWeek: 70 }, actor),
    ).rejects.toMatchObject({ code: 'not_active' })
  })

  it('refuses a change that changes nothing, and a pace out of range', async () => {
    await expect(
      changeRatingGoal(dependencies(world), { ...change, paceTenthsPerWeek: 110 }, actor),
    ).rejects.toMatchObject({ code: 'no_change' })
    for (const paceTenthsPerWeek of [9, 3501, 10.5]) {
      await expect(
        changeRatingGoal(dependencies(world), { ...change, paceTenthsPerWeek }, actor),
      ).rejects.toMatchObject({ code: 'invalid_pace' })
    }
    expect(world.changes).toEqual([])
  })

  it('takes a pace from 1 a week to 50 a day, in tenths', async () => {
    await changeRatingGoal(
      dependencies(world),
      { ...change, paceTenthsPerWeek: 3500 },
      actor,
    )
    await changeRatingGoal(
      dependencies(world),
      { ...change, expectedVersion: 2, paceTenthsPerWeek: 10 },
      actor,
    )

    expect(world.goals[0]).toMatchObject({ paceTenthsPerWeek: 10, version: 3 })
    expect(
      world.changes.map(({ field, oldValue, newValue }) => [field, oldValue, newValue]),
    ).toEqual([
      ['pace', '110', '3500'],
      ['pace', '3500', '10'],
    ])
  })

  it('answers not found for a goal of another Property', async () => {
    await expect(
      changeRatingGoal(
        dependencies(world),
        {
          ...change,
          propertyId: '30000000-0000-4000-8000-000000000099',
          paceTenthsPerWeek: 70,
        },
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
