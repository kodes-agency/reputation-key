import { beforeEach, describe, expect, it } from 'vitest'
import {
  RatingGoalSweepError,
  sweepRatingGoals,
  type AuthorizeRatingGoalScope,
} from './rating-goal-sweep'
import {
  activeGoal,
  dependencies,
  exampleWorld,
  NOW,
  type FakeWorld,
} from './rating-goal-test-fixtures'

let world: FakeWorld

const goalNumbered = (n: number) =>
  activeGoal({
    id: `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    propertyId: `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  })

const allowEverything: AuthorizeRatingGoalScope = async () => true

beforeEach(() => {
  world = exampleWorld()
  // No review in the pace window of a goal 40 days old at 11 a week.
  world.summary = { ...world.summary, counts: [0, 0, 0] }
})

describe('the daily evaluation of every active rating goal', () => {
  it('evaluates each one and tells its managers when it fell below pace', async () => {
    world.goals = [goalNumbered(1), goalNumbered(2)]

    const stats = await sweepRatingGoals(dependencies(world), allowEverything)

    expect(stats).toEqual({
      inspected: 2,
      evaluated: 2,
      denied: 0,
      notices: 2,
      failed: 0,
      failureCauses: {},
    })
    expect(world.notices).toEqual([
      expect.objectContaining({
        goalId: goalNumbered(1).id,
        transition: 'entered_below_pace',
        pacePerWeek: 11,
        recentPaceTenths: 0,
        paceWindow: 'last_4_weeks',
      }),
      expect.objectContaining({ goalId: goalNumbered(2).id }),
    ])
    expect(world.goals.map((goal) => goal.lastEvaluation)).toEqual([
      expect.objectContaining({ status: 'below_pace', belowPaceNoticedAt: NOW }),
      expect.objectContaining({ status: 'below_pace', belowPaceNoticedAt: NOW }),
    ])
  })

  it('tells nobody again on the next run', async () => {
    world.goals = [goalNumbered(1)]
    await sweepRatingGoals(dependencies(world), allowEverything)

    const again = await sweepRatingGoals(dependencies(world), allowEverything)

    expect(again).toMatchObject({ evaluated: 1, notices: 0 })
    expect(world.notices).toHaveLength(1)
  })

  it('reads nothing of a goal whose Organization or Property policy refuses', async () => {
    world.goals = [goalNumbered(1), goalNumbered(2)]
    const refused = goalNumbered(1).propertyId
    const asked: string[] = []
    const authorize: AuthorizeRatingGoalScope = async (organizationId, propertyId) => {
      asked.push(`${organizationId}/${propertyId}`)
      return propertyId !== refused
    }

    const stats = await sweepRatingGoals(dependencies(world), authorize)

    expect(stats).toMatchObject({ inspected: 2, evaluated: 1, denied: 1, notices: 1 })
    expect(asked).toEqual([
      `${goalNumbered(1).organizationId}/${goalNumbered(1).propertyId}`,
      `${goalNumbered(2).organizationId}/${goalNumbered(2).propertyId}`,
    ])
    expect(world.goals[0]!.lastEvaluation.status).toBe('on_pace')
  })

  it('pages through more goals than one listing holds', async () => {
    world.goals = Array.from({ length: 101 }, (_, i) => goalNumbered(i + 1))

    const stats = await sweepRatingGoals(dependencies(world), allowEverything)

    expect(stats).toMatchObject({ inspected: 101, evaluated: 101 })
  })

  it('finishes the others when one goal fails, then fails with content-free causes', async () => {
    world.goals = [goalNumbered(1), goalNumbered(2)]
    const deps = dependencies(world)
    const failing = goalNumbered(1).propertyId
    const findActive = deps.repository.findActive
    const repository = {
      ...deps.repository,
      findActive: async (organizationId: string, propertyId: string) => {
        if (propertyId === failing) {
          throw Object.assign(new Error('connection reset'), { code: '08006' })
        }
        return findActive(organizationId, propertyId)
      },
    }

    const run = sweepRatingGoals({ ...deps, repository }, allowEverything)

    await expect(run).rejects.toBeInstanceOf(RatingGoalSweepError)
    await expect(run).rejects.toMatchObject({
      message: 'Rating goal evaluation failed for 1 goal(s): sqlstate_08006 x1',
      stats: {
        inspected: 2,
        evaluated: 1,
        failed: 1,
        failureCauses: { sqlstate_08006: 1 },
      },
    })
    expect(world.notices.map((notice) => notice.goalId)).toEqual([goalNumbered(2).id])
  })

  it('fails the run for a retry when the policy cannot be read', async () => {
    world.goals = [goalNumbered(1)]
    const unavailable: AuthorizeRatingGoalScope = async () => {
      throw new Error('policy unavailable')
    }

    await expect(sweepRatingGoals(dependencies(world), unavailable)).rejects.toThrow(
      'policy unavailable',
    )
    expect(world.notices).toEqual([])
  })

  it('skips a goal that ended and was replaced since it was listed', async () => {
    world.goals = [goalNumbered(1)]
    const deps = dependencies(world)
    const repository = {
      ...deps.repository,
      findActive: async () => ({ ...goalNumbered(1), id: 'a-newer-goal' }),
    }

    const stats = await sweepRatingGoals({ ...deps, repository }, allowEverything)

    expect(stats).toMatchObject({ inspected: 1, evaluated: 0, notices: 0 })
  })
})
