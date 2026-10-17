// The Monday check-in as the card read hands it on (round 5, PLAN-D D-3, owner
// answer Q4): last week's count, its average only from ten reviews, the plan it
// is compared with, and the paces Raise and Ease move to.
//
// The read is on Wednesday 14 Oct 2026 in Sofia; last week ran from Monday
// 5 Oct 00:00 (21:00 UTC on the 4th) to Monday 12 Oct 00:00.
import { beforeEach, describe, expect, it } from 'vitest'
import {
  actor,
  activeGoal,
  dependencies,
  exampleWorld,
  PROPERTY,
  type FakeWorld,
} from './use-cases/rating-goal-test-fixtures'
import { getRatingGoalCard } from './use-cases/rating-goal-reads'
import { recapView } from './rating-goal-recap-views'

let world: FakeWorld

beforeEach(() => {
  world = exampleWorld()
  // 4.5 at 11 a week (110 tenths), set 40 days ago; 40 of the 39.6 its window asks: on pace.
  world.goals = [activeGoal()]
  world.summary = { ...world.summary, counts: [28, 2, 40, 0] }
})

const readRecap = async () =>
  (await getRatingGoalCard(dependencies(world), { propertyId: PROPERTY }, actor))?.recap

describe('the Monday check-in on the card', () => {
  it('looks back on last Property-local week, in the same scan as the card', async () => {
    await expect(readRecap()).resolves.toEqual({
      weekStart: '2026-10-05',
      count: 8,
      averageTenths: null,
      plannedLastWeek: 11,
      raiseToTenths: 140,
      easeToTenths: 70,
    })
    expect(world.summaryRequests.at(-1)?.rangeTotals).toEqual({
      from: new Date('2026-10-04T21:00:00.000Z'),
      to: new Date('2026-10-11T21:00:00.000Z'),
      minimumCount: 10,
    })
  })

  it('gives last week’s average as a tenth from ten reviews', async () => {
    // 55 stars over 12 is 4.58: 4.6.
    world.summary = { ...world.summary, lastWeek: { count: 12, sum: 55 } }

    await expect(readRecap()).resolves.toMatchObject({ count: 12, averageTenths: 46 })
  })

  it('states the count alone after a pace change during last week', async () => {
    // Changed on Thursday 8 Oct to 2 a day: getting started again, still asked.
    world.goals = [
      activeGoal({
        paceTenthsPerWeek: 140,
        paceSince: new Date('2026-10-08T07:00:00.000Z'),
      }),
    ]

    await expect(readRecap()).resolves.toMatchObject({
      plannedLastWeek: null,
      raiseToTenths: 210,
      easeToTenths: 70,
    })
  })

  it('is gone once last week was kept, for every manager', async () => {
    world.goals = [activeGoal({ recapAnsweredWeek: '2026-10-05' })]

    await expect(readRecap()).resolves.toBeNull()
  })

  it('is not asked while new reviews are too low, nor of a keep goal', async () => {
    world.summary = { ...world.summary, sinceSet: { count: 10, sum: 40 } }
    await expect(readRecap()).resolves.toBeNull()

    world.summary = { ...world.summary, sinceSet: { count: 9, sum: 41 } }
    world.goals = [
      activeGoal({
        mode: 'keep',
        targetTenths: 43,
        qualityTenths: null,
        paceTenthsPerWeek: null,
      }),
    ]
    await expect(readRecap()).resolves.toBeNull()
  })
})

describe('the check-in built from what the card read found', () => {
  const facts = {
    status: 'on_pace' as const,
    googleShowsSoon: false,
    now: new Date('2026-10-14T12:00:00.000Z'),
    timezone: 'Europe/Sofia',
  }

  it('names no average for a week without reviews, and no plan without a pace', () => {
    expect(
      recapView(activeGoal(), { ...facts, lastWeek: { count: 0, sum: null } }),
    ).toEqual(
      expect.objectContaining({ count: 0, averageTenths: null, plannedLastWeek: 11 }),
    )
    expect(
      recapView(
        activeGoal({ mode: 'keep', paceTenthsPerWeek: null, qualityTenths: null }),
        { ...facts, status: 'holding', lastWeek: { count: 3, sum: null } },
      ),
    ).toBeNull()
  })
})
