// A new pace starts its own window (round 5 D-3, owner answer Q3), through the
// use cases: a manager changes the pace of a running goal, and the card reads
// that evaluate it afterwards decide its status and its notices.
//
// The goal was set 40 days before the change at 7 a week; the change raises
// or eases it. The pace window's count is the read's third windowed count
// (28 days, this week, the pace window).
import { beforeEach, describe, expect, it } from 'vitest'
import type { RatingGoalStatus } from '../../domain/rating-goal'
import { changeRatingGoal } from './rating-goal-commands'
import { getRatingGoalCard } from './rating-goal-reads'
import {
  actor,
  activeGoal,
  DAY,
  dependencies,
  exampleWorld,
  NOW,
  PROPERTY,
  type FakeWorld,
} from './rating-goal-test-fixtures'

let world: FakeWorld

const SET_AT = new Date(NOW.getTime() - 40 * DAY)

/** The use cases' dependencies on day `day` after the change, Google's numbers an hour old. */
function onDay(day: number, paceWindowReviews = 0) {
  const now = new Date(NOW.getTime() + day * DAY)
  world.snapshot = { ...world.snapshot!, verifiedAt: new Date(now.getTime() - 3_600_000) }
  world.summary = { ...world.summary, counts: [28, 0, paceWindowReviews, 0] }
  return { ...dependencies(world), now: () => now }
}

function goalKnowing(status: RatingGoalStatus) {
  world.goals = [
    activeGoal({
      createdAt: SET_AT,
      paceSince: SET_AT,
      paceTenthsPerWeek: 70,
      lastEvaluation: {
        displayedTenths: 43,
        status,
        evaluatedAt: new Date(NOW.getTime() - DAY),
        knownStatus: status,
        belowPaceNoticedAt:
          status === 'below_pace' ? new Date(NOW.getTime() - 20 * DAY) : null,
        tooLowNoticedAt: null,
      },
    }),
  ]
}

const changePace = (paceTenthsPerWeek: number) =>
  changeRatingGoal(
    onDay(0),
    {
      propertyId: PROPERTY,
      goalId: world.goals[0]!.id,
      expectedVersion: 1,
      paceTenthsPerWeek,
    },
    actor,
  )

const statusOn = async (day: number, paceWindowReviews = 0) =>
  (
    await getRatingGoalCard(
      onDay(day, paceWindowReviews),
      { propertyId: PROPERTY },
      actor,
    )
  )?.status

const belowPaceNotices = () =>
  world.notices.filter((notice) => notice.transition === 'entered_below_pace')

beforeEach(() => {
  world = exampleWorld()
})

describe('a pace change on a running goal (Q3)', () => {
  it('starts the goal afresh instead of reading a raised pace below at once', async () => {
    goalKnowing('on_pace')

    await changePace(140)

    expect(world.goals[0]?.paceSince).toEqual(NOW)
    await expect(statusOn(1)).resolves.toBe('getting_started')
    await expect(statusOn(13.9)).resolves.toBe('getting_started')
    expect(belowPaceNotices()).toEqual([])
    expect(world.goals[0]?.lastEvaluation.knownStatus).toBe('on_pace')
  })

  it('judges the new pace from the change, and only from day 14', async () => {
    goalKnowing('on_pace')
    await changePace(140)

    // 14 days at 14 a week is 28; 90% is 25.2.
    await expect(statusOn(14, 26)).resolves.toBe('on_pace')
    expect(world.summaryRequests.at(-1)?.countSince[2]).toEqual(NOW)
  })

  it('tells below pace once, since the pace changed, when the goal was on pace before', async () => {
    goalKnowing('on_pace')
    await changePace(140)
    await statusOn(1)

    await expect(statusOn(14, 10)).resolves.toBe('below_pace')
    await statusOn(15, 10)

    expect(belowPaceNotices()).toEqual([
      expect.objectContaining({
        paceWindow: 'since_pace_change',
        paceTenthsPerWeek: 140,
      }),
    ])
  })

  it('tells nothing when a goal below pace before the change is still below at day 14', async () => {
    goalKnowing('below_pace')
    await changePace(140)
    await statusOn(1)

    await expect(statusOn(14, 10)).resolves.toBe('below_pace')

    expect(belowPaceNotices()).toEqual([])
  })

  it('tells nothing when an eased pace leaves the goal on pace', async () => {
    goalKnowing('below_pace')
    await changePace(30)
    await statusOn(1)

    // 14 days at 3 a week is 6; 90% is 5.4.
    await expect(statusOn(14, 6)).resolves.toBe('on_pace')

    expect(world.notices).toEqual([])
  })

  it('still forgets the known status when the target moves too', async () => {
    goalKnowing('on_pace')

    await changeRatingGoal(
      onDay(0),
      {
        propertyId: PROPERTY,
        goalId: world.goals[0]!.id,
        expectedVersion: 1,
        targetTenths: 46,
        paceTenthsPerWeek: 140,
      },
      actor,
    )

    expect(world.goals[0]?.lastEvaluation.knownStatus).toBeNull()
  })
})
