// "Keep" in the Monday check-in (round 5, PLAN-D D-3, owner answer Q4): a
// manager keeps the pace for this week. It answers the check-in for every
// manager, moves no version and logs no change, and is refused once the
// check-in it answers has closed. With a Raise or Ease from another tab
// (changeRatingGoal), whichever lands first decides.
//
// The read is on Wednesday 14 Oct 2026 in Sofia: the check-in looks back on
// the week of Monday 5 Oct.
import { beforeEach, describe, expect, it } from 'vitest'
import { changeRatingGoal, keepRatingGoalPace } from './rating-goal-commands'
import { getRatingGoalCard } from './rating-goal-reads'
import {
  actor,
  activeGoal,
  dependencies,
  exampleWorld,
  PROPERTY,
  type FakeWorld,
} from './rating-goal-test-fixtures'

const LAST_WEEK = '2026-10-05'

let world: FakeWorld

beforeEach(() => {
  world = exampleWorld()
  world.goals = [activeGoal()]
})

const goalId = () => world.goals[0]!.id
const keep = (weekStart = LAST_WEEK) =>
  keepRatingGoalPace(
    dependencies(world),
    { propertyId: PROPERTY, goalId: goalId(), weekStart },
    actor,
  )
const raise = (expectedVersion = 1) =>
  changeRatingGoal(
    dependencies(world),
    { propertyId: PROPERTY, goalId: goalId(), expectedVersion, paceTenthsPerWeek: 140 },
    actor,
  )
const recap = async () =>
  (await getRatingGoalCard(dependencies(world), { propertyId: PROPERTY }, actor))?.recap

describe('keeping the pace for this week', () => {
  it('answers the check-in for every manager, with no new version and no log row', async () => {
    await expect(keep()).resolves.toEqual({ goalId: goalId(), weekStart: LAST_WEEK })

    expect(world.goals[0]).toMatchObject({ recapAnsweredWeek: LAST_WEEK, version: 1 })
    expect(world.changes).toEqual([])
    await expect(recap()).resolves.toBeNull()
  })

  it('asks the Goal policy for goal.update', async () => {
    await keep()

    expect(world.authorizations[0]).toBe(`goal.update:${PROPERTY}`)
  })

  it('succeeds twice and stores one week', async () => {
    await keep()
    await expect(keep()).resolves.toEqual({ goalId: goalId(), weekStart: LAST_WEEK })

    expect(world.goals[0]?.recapAnsweredWeek).toBe(LAST_WEEK)
  })

  it('refuses a week whose check-in is not the one open now', async () => {
    await expect(keep('2026-09-28')).rejects.toMatchObject({ code: 'recap_closed' })

    expect(world.goals[0]?.recapAnsweredWeek).toBeNull()
  })

  it('refuses after a Raise from another tab: the new pace answered the week', async () => {
    await raise()

    await expect(keep()).rejects.toMatchObject({ code: 'recap_closed' })
  })

  it('lets a Raise from another tab apply after a Keep, which moved no version', async () => {
    await keep()

    await expect(raise(1)).resolves.toEqual({ goalId: goalId(), version: 2 })
  })

  it('lets only the first of two Raises from two tabs apply', async () => {
    await raise(1)

    await expect(raise(1)).rejects.toMatchObject({ code: 'version_conflict' })
  })

  it('refuses a keep goal and a goal no longer active', async () => {
    world.goals = [
      activeGoal({
        mode: 'keep',
        targetTenths: 43,
        qualityTenths: null,
        paceTenthsPerWeek: null,
      }),
    ]
    await expect(keep()).rejects.toMatchObject({ code: 'not_active' })

    world.goals = [activeGoal({ state: 'ended', endedReason: 'manager' })]
    await expect(keep()).rejects.toMatchObject({ code: 'not_active' })
  })

  it('refuses while the check-in is not due: new reviews too low', async () => {
    world.summary = { ...world.summary, sinceSet: { count: 10, sum: 40 } }

    await expect(keep()).rejects.toMatchObject({ code: 'recap_closed' })
  })
})
