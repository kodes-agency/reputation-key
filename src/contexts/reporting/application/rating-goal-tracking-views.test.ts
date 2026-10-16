// The card's climb as the card read hands it on (round 5, PLAN-D D-1): the
// next number, what is still needed, the number above the goal, when the goal
// arrives in days, the day of the week and the last four weeks.
import { beforeEach, describe, expect, it } from 'vitest'
import type { RatingArrivalView } from './dto/rating-goal.types'
import {
  actor,
  activeGoal,
  DAY,
  dependencies,
  exampleWorld,
  NOW,
  PROPERTY,
  type FakeWorld,
} from './use-cases/rating-goal-test-fixtures'
import { getRatingGoalCard } from './use-cases/rating-goal-reads'

let world: FakeWorld

beforeEach(() => {
  world = exampleWorld()
})

const input = { propertyId: PROPERTY }
const readCard = () => getRatingGoalCard(dependencies(world), input, actor)

/** Google's count and number, and the cache holding all of its reviews. */
function numbers(reviewCount: number, sum: number, googleAverage: number) {
  world.snapshot = { ...world.snapshot!, reviewCount, averageRating: googleAverage }
  world.summary = { ...world.summary, all: { count: reviewCount, sum } }
}

const days = (arrival: RatingArrivalView | null) => {
  if (arrival?.kind !== 'days') throw new Error(`expected days, got ${arrival?.kind}`)
  const of = (fraction: Readonly<{ num: number; den: number }>) =>
    Number((fraction.num / fraction.den).toFixed(2))
  return {
    central: of(arrival.central),
    fast: of(arrival.fast),
    slow: arrival.slow === null ? null : of(arrival.slow),
  }
}

/** Harborline at the set: 4.1 at 1 a day and 4.5★, set three days ago. */
function harborlineJustSet() {
  // Google's 3.9 arrives as its float32 artefact.
  numbers(261, 1021, 3.9000000953674316)
  world.summary = { ...world.summary, sinceSet: { count: 0, sum: 0 } }
  world.goals = [
    activeGoal({
      targetTenths: 41,
      qualityTenths: 45,
      paceTenthsPerWeek: 70,
      baseline: { reviewCount: 261, googleAverage: 3.9, exactAverage: 3.912 },
      createdAt: new Date(NOW.getTime() - 3 * DAY),
    }),
  ]
}

describe('the card’s climb', () => {
  it('agrees with the setup’s receipt at the set (Harborline: 19 to 4.0, 81 to 4.1, 4.2 possible)', async () => {
    harborlineJustSet()

    const card = await readCard()

    expect(card).toMatchObject({
      forecastBasis: 'chosen_pace',
      // The next number Google can show first, then the goal.
      next: { targetTenths: 40, target: 4, reviewsNeeded: 19 },
      earnedTenths: null,
      stillNeeded: 81,
      nextUp: { targetTenths: 42, reviewsBeyondGoal: 97 },
      baseline: { googleShows: 3.9, reviewCount: 261, exactAverage: 3.912 },
    })
    expect(days(card!.forecast)).toEqual({ central: 81, fast: 60, slow: 114.44 })
    expect(card!.nextUp!.days.num / card!.nextUp!.days.den).toBe(178)
  })

  it('counts to the goal past a tenth Google should show soon (shown 4.3, exact 4.36)', async () => {
    numbers(500, 2180, 4.300000190734863)
    world.summary = { ...world.summary, sinceSet: { count: 0, sum: 0 } }
    world.goals = [
      activeGoal({
        targetTenths: 45,
        qualityTenths: 47,
        paceTenthsPerWeek: 70,
        createdAt: new Date(NOW.getTime() - 3 * DAY),
      }),
    ]

    const card = await readCard()

    // Never "0 new reviews to 4.4".
    expect(card).toMatchObject({
      googleShowsSoon: false,
      next: { targetTenths: 45, target: 4.5, reviewsNeeded: 180 },
      earnedTenths: 44,
      stillNeeded: 180,
      // 4.6 clears its 4.7 floor at 4.7: 634 in all, 454 past the goal.
      nextUp: { targetTenths: 46, reviewsBeyondGoal: 454 },
    })
    expect(days(card!.forecast)).toEqual({ central: 180, fast: 117.27, slow: 333.33 })
    expect(card!.nextUp!.days.num / card!.nextUp!.days.den).toBe(634)
  })

  it('counts to nothing once the reviews have earned the goal and Google lags', async () => {
    numbers(100, 412, 4.0)
    world.summary = { ...world.summary, sinceSet: { count: 0, sum: 0 } }
    world.goals = [activeGoal({ targetTenths: 41, qualityTenths: 45 })]

    const card = await readCard()

    expect(card).toMatchObject({
      googleShowsSoon: true,
      next: null,
      earnedTenths: null,
      stillNeeded: 0,
      forecast: { kind: 'earned' },
    })
  })

  it('works on Google’s own figure while the cache is short of its count', async () => {
    world.goals = [activeGoal()]
    // 700 of Google's 812: the exact average is Google's 4.3.
    world.summary = { ...world.summary, all: { count: 700, sum: 3000 } }

    const card = await readCard()

    expect(card).toMatchObject({
      exactAverageSource: 'google',
      next: { targetTenths: 44, target: 4.4 },
    })
  })

  it('reaches nothing at the new reviews’ own average while they are too low', async () => {
    world.goals = [activeGoal()]
    world.summary = { ...world.summary, sinceSet: { count: 20, sum: 89 } }

    const card = await readCard()

    expect(card).toMatchObject({
      status: 'reviews_too_low',
      stillNeeded: null,
      nextUp: null,
      forecast: { kind: 'unreachable' },
    })
  })

  it('has no climb for a goal that keeps a number, only the week and the start', async () => {
    world.goals = [
      activeGoal({
        mode: 'keep',
        targetTenths: 43,
        qualityTenths: null,
        paceTenthsPerWeek: null,
      }),
    ]

    const card = await readCard()

    expect(card).toMatchObject({
      next: null,
      earnedTenths: null,
      stillNeeded: null,
      nextUp: null,
      forecast: null,
      weekday: 3,
      baseline: { googleShows: 4.3 },
    })
  })

  it('names the day of the Property week, Monday first', async () => {
    world.goals = [activeGoal()]
    // Sunday 18 Oct 2026, 21:30 UTC, is Monday 00:30 in Sofia.
    const monday = new Date('2026-10-18T21:30:00.000Z')

    const card = await getRatingGoalCard(
      { ...dependencies(world), now: () => monday },
      input,
      actor,
    )

    expect(card?.weekday).toBe(1)
  })
})
