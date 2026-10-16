import { beforeEach, describe, expect, it } from 'vitest'
import {
  RatingGoalSweepError,
  sweepRatingGoals,
  type AuthorizeRatingGoalScope,
} from './rating-goal-sweep'
import {
  activeGoal,
  DAY,
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
        paceTenthsPerWeek: 110,
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

  it('keeps waiting for Google, and tells nobody, while the review cache is empty', async () => {
    // Google shows 4.2 from 30 reviews; the cache holds none of them yet. The
    // goal is 20 days old at 7 a week: with no review counted it would read
    // as below pace.
    world.snapshot = { ...world.snapshot!, reviewCount: 30, averageRating: 4.2 }
    const none = { count: 0, sum: 0 }
    world.summary = { ...world.summary, all: none, mixWindow: none, mostRecent: none }
    world.goals = [
      activeGoal({
        targetTenths: 44,
        paceTenthsPerWeek: 70,
        createdAt: new Date(NOW.getTime() - 20 * DAY),
      }),
    ]

    await sweepRatingGoals(dependencies(world), allowEverything)

    expect(world.goals[0]!.lastEvaluation).toMatchObject({
      status: 'waiting_for_google',
      knownStatus: 'on_pace',
    })
    expect(world.notices).toEqual([])
  })

  it('tells nobody again on the next run', async () => {
    world.goals = [goalNumbered(1)]
    await sweepRatingGoals(dependencies(world), allowEverything)

    const again = await sweepRatingGoals(dependencies(world), allowEverything)

    expect(again).toMatchObject({ evaluated: 1, notices: 0 })
    expect(world.notices).toHaveLength(1)
  })

  describe('when new reviews since the set average too low for the target', () => {
    beforeEach(() => {
      // 30 reviews since the goal was set at 4.33 against the 4.45 a 4.5
      // needs. With no review in the pace window too, it is still the status:
      // it comes first.
      world.summary = { ...world.summary, sinceSet: { count: 30, sum: 130 } }
    })

    it('says nothing about a recent mix that trails the threshold before ten new reviews', async () => {
      world.summary = {
        ...world.summary,
        mixWindow: { count: 30, sum: 130 },
        sinceSet: { count: 9, sum: 9 },
      }
      world.goals = [goalNumbered(1)]

      await sweepRatingGoals(dependencies(world), allowEverything)

      expect(world.notices.map((notice) => notice.transition)).toEqual([
        'entered_below_pace',
      ])
    })

    it('tells its managers once, with the target and no star figure', async () => {
      world.goals = [goalNumbered(1)]

      await sweepRatingGoals(dependencies(world), allowEverything)

      expect(world.notices).toEqual([
        {
          goalId: goalNumbered(1).id,
          transition: 'entered_reviews_too_low',
          targetTenths: 45,
        },
      ])
      expect(world.goals[0]!.lastEvaluation).toMatchObject({
        status: 'reviews_too_low',
        knownStatus: 'reviews_too_low',
        tooLowNoticedAt: NOW,
        belowPaceNoticedAt: null,
      })
    })

    it('keeps quiet within 14 days of the last too-low notice, and still stores the status', async () => {
      const told = new Date(NOW.getTime() - 13 * DAY)
      world.goals = [
        activeGoal({
          ...goalNumbered(1),
          lastEvaluation: { ...goalNumbered(1).lastEvaluation, tooLowNoticedAt: told },
        }),
      ]

      await sweepRatingGoals(dependencies(world), allowEverything)

      expect(world.notices).toEqual([])
      expect(world.goals[0]!.lastEvaluation).toMatchObject({
        knownStatus: 'reviews_too_low',
        tooLowNoticedAt: told,
      })
    })

    it('tells again once 14 days have passed since the last one', async () => {
      world.goals = [
        activeGoal({
          ...goalNumbered(1),
          lastEvaluation: {
            ...goalNumbered(1).lastEvaluation,
            tooLowNoticedAt: new Date(NOW.getTime() - 14 * DAY),
          },
        }),
      ]

      await sweepRatingGoals(dependencies(world), allowEverything)

      expect(world.notices.map((notice) => notice.transition)).toEqual([
        'entered_reviews_too_low',
      ])
      expect(world.goals[0]!.lastEvaluation.tooLowNoticedAt).toEqual(NOW)
    })
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
