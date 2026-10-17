import { describe, expect, it } from 'vitest'
import { compareRatios, ratio } from './rating-goal-numbers'
import {
  GOOGLE_NUMBERS_FRESH_HOURS,
  cacheShowsTargetFirst,
  climbStatus,
  forecastPaceBasis,
  googleIsWaiting,
  keepStatus,
  PLANNED_AVERAGE_WEIGHT_REVIEWS,
  reviewsTooLow,
  statusPaceWindow,
  trackingMix,
} from './rating-goal-status'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-14T12:00:00.000Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY)

const climb = (overrides: Partial<Parameters<typeof climbStatus>[0]> = {}) =>
  climbStatus({
    waiting: false,
    displayedTenths: 43,
    targetTenths: 45,
    // 12 reviews since the goal was set, averaging 4.67.
    sinceSet: { count: 12, sum: 56 },
    goalCreatedAt: daysAgo(30),
    now: NOW,
    chosenTenthsPerWeek: 100,
    reviewsInPaceWindow: 36,
    ...overrides,
  })

describe('whether Google’s numbers can be used', () => {
  it('waits without a snapshot, on a disconnected binding, or after 24 hours', () => {
    expect(GOOGLE_NUMBERS_FRESH_HOURS).toBe(24)
    const fresh = { verifiedAt: new Date(NOW.getTime() - 23 * 60 * 60 * 1000) }
    const stale = { verifiedAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000 - 1) }

    expect(googleIsWaiting(fresh, true, NOW)).toBe(false)
    expect(googleIsWaiting(null, true, NOW)).toBe(true)
    expect(googleIsWaiting(fresh, false, NOW)).toBe(true)
    expect(googleIsWaiting(stale, true, NOW)).toBe(true)
  })
})

describe('the status of a climb goal, top rule first', () => {
  it('waits for Google before anything else, even with the target shown', () => {
    expect(climb({ waiting: true, displayedTenths: 45 })).toBe('waiting_for_google')
  })

  it('is reached when Google shows the target', () => {
    expect(climb({ displayedTenths: 45, sinceSet: { count: 10, sum: 30 } })).toBe(
      'reached',
    )
    expect(climb({ displayedTenths: 46 })).toBe('reached')
  })

  it('says new reviews are too low once ten since the set average at or below the threshold', () => {
    // 20 reviews at exactly 4.45 against 4.5's threshold 4.45.
    expect(climb({ sinceSet: { count: 20, sum: 89 } })).toBe('reviews_too_low')
    expect(climb({ sinceSet: { count: 10, sum: 40 }, goalCreatedAt: daysAgo(1) })).toBe(
      'reviews_too_low',
    )
  })

  it('gives no quality verdict before ten reviews arrived since the set', () => {
    // Nine reviews at one star each.
    expect(climb({ sinceSet: { count: 9, sum: 9 } })).toBe('on_pace')
  })

  it('is not too low while the since-set average clears the threshold', () => {
    expect(climb({ sinceSet: { count: 20, sum: 90 } })).toBe('on_pace')
  })

  it('is getting started for the first 14 days', () => {
    expect(climb({ goalCreatedAt: daysAgo(13), reviewsInPaceWindow: null })).toBe(
      'getting_started',
    )
  })

  it('is on pace at 90% of the chosen pace or more, below it under that', () => {
    // 28 days at 10 a week is 40; 90% is 36.
    expect(climb({ reviewsInPaceWindow: 36 })).toBe('on_pace')
    expect(climb({ reviewsInPaceWindow: 35 })).toBe('below_pace')
  })

  it('judges a goal set 21 days ago on its 21 days', () => {
    // 21 days at 10 a week is 30; 90% is 27.
    expect(climb({ goalCreatedAt: daysAgo(21), reviewsInPaceWindow: 27 })).toBe('on_pace')
    expect(climb({ goalCreatedAt: daysAgo(21), reviewsInPaceWindow: 26 })).toBe(
      'below_pace',
    )
  })

  it('judges a pace with a tenth of a review a week', () => {
    // 1.5 a day is 10.5 a week: 28 days is 42, and 90% is 37.8.
    expect(climb({ chosenTenthsPerWeek: 105, reviewsInPaceWindow: 38 })).toBe('on_pace')
    expect(climb({ chosenTenthsPerWeek: 105, reviewsInPaceWindow: 37 })).toBe(
      'below_pace',
    )
  })

  it('decides exactly at 50 a day, past the integers a JS number holds', () => {
    // 28 days at 350 a week is 1,400; 90% is 1,260. The products compared
    // pass 2^53 here.
    const fifty = { chosenTenthsPerWeek: 3500 }
    expect(climb({ ...fifty, reviewsInPaceWindow: 1260 })).toBe('on_pace')
    expect(climb({ ...fifty, reviewsInPaceWindow: 1259 })).toBe('below_pace')
    expect(climb({ ...fifty, reviewsInPaceWindow: 20_000 })).toBe('on_pace')
  })

  it('is below pace with no reviews at all', () => {
    expect(climb({ reviewsInPaceWindow: 0 })).toBe('below_pace')
  })
})

describe('the stars new reviews are expected to average', () => {
  it('is the planned quality while no review arrived since the goal was set', () => {
    expect(trackingMix(47, { count: 0, sum: 0 }, 45)).toEqual({
      mix: ratio(47, 10),
      basis: 'planned',
    })
  })

  it('blends the plan, counted as 15 reviews, with the first new review', () => {
    // (15 × 4.7 + 4) / 16 = 74.5 / 16.
    expect(PLANNED_AVERAGE_WEIGHT_REVIEWS).toBe(15)
    expect(trackingMix(47, { count: 1, sum: 4 }, 45)).toEqual({
      mix: ratio(745, 160),
      basis: 'blended',
    })
  })

  it('keeps blending before the verdict while the blend still clears the target', () => {
    // Nine reviews at 4.0: no verdict yet, (70.5 + 36) / 24 = 4.4375 clears 4.0's 3.95.
    expect(trackingMix(47, { count: 9, sum: 36 }, 40)).toEqual({
      mix: ratio(1065, 240),
      basis: 'blended',
    })
  })

  it('one 2★ review after a floor plan keeps the goal reachable before the verdict', () => {
    // A plan at 4.6 for 4.5 (threshold 4.45): the blend (69 + 2) / 16 = 4.4375
    // would read "not reachable" after one review, a verdict R2-5 holds to ten.
    // The floor is the plan itself, so the numbers assume the plan.
    expect(trackingMix(46, { count: 1, sum: 2 }, 45)).toEqual({
      mix: ratio(46, 10),
      basis: 'planned',
    })
  })

  it('holds the blend at the target’s minimum quality before the verdict', () => {
    // Plan 4.8 for 4.5: three 3★ reviews blend to (72 + 9) / 18 = 4.5, under
    // 4.6, the least a plan for 4.5 may assume; one 4★ review blends to 4.75.
    expect(trackingMix(48, { count: 3, sum: 9 }, 45)).toEqual({
      mix: ratio(46, 10),
      basis: 'blended',
    })
    expect(trackingMix(48, { count: 1, sum: 4 }, 45)).toEqual({
      mix: ratio(760, 160),
      basis: 'blended',
    })
  })

  it('holds no floor from the tenth review on', () => {
    // Plan 4.6 for 4.5, 20 reviews at 4.5 (not too low): (69 + 90) / 35 = 4.543.
    expect(trackingMix(46, { count: 20, sum: 90 }, 45)).toEqual({
      mix: ratio(1590, 350),
      basis: 'blended',
    })
  })

  it('never lets the numbers fall below the target’s minimum quality before ten reviews', () => {
    // Every star sum for 1..9 reviews, plans at the floor up to 0.2 above it.
    for (const target of [38, 40, 43, 45, 48]) {
      for (const plan of [target + 1, target + 2, target + 3].filter((q) => q <= 50)) {
        for (let count = 1; count < 10; count++) {
          for (let sum = count; sum <= 5 * count; sum++) {
            const { mix } = trackingMix(plan, { count, sum }, target)
            expect(compareRatios(mix, ratio(target + 1, 10))).toBeGreaterThanOrEqual(0)
          }
        }
      }
    }
  })

  it('blends from the tenth review on while they clear the target', () => {
    // 20 reviews at 4.55 clear 4.5's 4.45: (70.5 + 91) / 35.
    expect(trackingMix(47, { count: 20, sum: 91 }, 45)).toEqual({
      mix: ratio(1615, 350),
      basis: 'blended',
    })
  })

  it('is their own average once they are too low, as the status says', () => {
    // 20 reviews at exactly 4.45, the threshold of 4.5: too low, so no blend.
    expect(trackingMix(47, { count: 20, sum: 89 }, 45)).toEqual({
      mix: ratio(89, 20),
      basis: 'since_set',
    })
  })

  it('moves the planned average less at the tenth review than a switch would', () => {
    // A plan of 4.5 with ten reviews at 4.1: the blend is 4.34, a switch was 4.1.
    const { mix } = trackingMix(45, { count: 10, sum: 41 }, 40)
    expect(mix).toEqual(ratio(1085, 250))
  })

  it('is too low only at ten reviews or more, at or below the threshold', () => {
    // 3.95 is 4.0's threshold.
    expect(reviewsTooLow({ count: 20, sum: 79 }, 40)).toBe(true)
    expect(reviewsTooLow({ count: 20, sum: 80 }, 40)).toBe(false)
    expect(reviewsTooLow({ count: 9, sum: 9 }, 40)).toBe(false)
  })
})

describe('the window the pace is judged on', () => {
  it('has none before day 14', () => {
    expect(statusPaceWindow(daysAgo(13.9), NOW)).toBeNull()
  })

  it('runs from the day the goal was set until day 28', () => {
    expect(statusPaceWindow(daysAgo(14), NOW)).toEqual({ start: daysAgo(14), end: NOW })
    expect(statusPaceWindow(daysAgo(27), NOW)).toEqual({ start: daysAgo(27), end: NOW })
  })

  it('is the last 28 days from then on', () => {
    expect(statusPaceWindow(daysAgo(90), NOW)).toEqual({ start: daysAgo(28), end: NOW })
  })

  it('forecasts the simple card at the actual pace once the goal is 28 days old', () => {
    expect(forecastPaceBasis(daysAgo(27), NOW)).toBe('chosen')
    expect(forecastPaceBasis(daysAgo(28), NOW)).toBe('actual')
  })
})

describe('the status of a keep goal', () => {
  it('holds while Google shows the kept tenth or more', () => {
    expect(keepStatus({ waiting: false, displayedTenths: 45, targetTenths: 45 })).toBe(
      'holding',
    )
    expect(keepStatus({ waiting: false, displayedTenths: 44, targetTenths: 45 })).toBe(
      'dropped_below',
    )
    expect(keepStatus({ waiting: true, displayedTenths: 44, targetTenths: 45 })).toBe(
      'waiting_for_google',
    )
  })
})

describe('when the cache gets there before Google shows it', () => {
  it('says so while Google still shows less than the target', () => {
    expect(cacheShowsTargetFirst(ratio(4451, 1000), 44, 45)).toBe(true)
    expect(cacheShowsTargetFirst(ratio(4449, 1000), 44, 45)).toBe(false)
    expect(cacheShowsTargetFirst(ratio(4451, 1000), 45, 45)).toBe(false)
  })
})
