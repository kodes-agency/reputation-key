import { describe, expect, it } from 'vitest'
import { ratio } from './rating-goal-numbers'
import {
  GOOGLE_NUMBERS_FRESH_HOURS,
  cacheShowsTargetFirst,
  climbStatus,
  forecastPaceBasis,
  googleIsWaiting,
  keepStatus,
  nextTenthMilestone,
  ratingProgress,
  statusPaceWindow,
} from './rating-goal-status'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-14T12:00:00.000Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY)

const climb = (overrides: Partial<Parameters<typeof climbStatus>[0]> = {}) =>
  climbStatus({
    waiting: false,
    displayedTenths: 43,
    targetTenths: 45,
    mix: ratio(470, 100),
    goalCreatedAt: daysAgo(30),
    now: NOW,
    chosenPerWeek: 10,
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
    expect(climb({ displayedTenths: 45, mix: ratio(4, 1) })).toBe('reached')
    expect(climb({ displayedTenths: 46 })).toBe('reached')
  })

  it("can't reach the target when the recent mix does not clear its threshold", () => {
    expect(climb({ mix: ratio(445, 100) })).toBe('cant_reach_at_mix')
    expect(climb({ mix: ratio(445, 100), goalCreatedAt: daysAgo(1) })).toBe(
      'cant_reach_at_mix',
    )
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

  it('is below pace with no reviews at all', () => {
    expect(climb({ reviewsInPaceWindow: 0 })).toBe('below_pace')
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

describe('progress towards the threshold', () => {
  it('runs from the baseline exact average to the threshold', () => {
    // Baseline 4.31, now 4.38, threshold 4.45: 0.07 of 0.14.
    expect(ratingProgress(ratio(438, 100), 4.31, 4450)).toBeCloseTo(0.5, 6)
  })

  it('is held between nothing and complete', () => {
    expect(ratingProgress(ratio(425, 100), 4.31, 4450)).toBe(0)
    expect(ratingProgress(ratio(450, 100), 4.31, 4450)).toBe(1)
  })

  it('is complete or nothing when the baseline already met the threshold', () => {
    expect(ratingProgress(ratio(446, 100), 4.46, 4450)).toBe(1)
    expect(ratingProgress(ratio(444, 100), 4.46, 4450)).toBe(0)
  })
})

describe('the next tenth on the way', () => {
  it('counts the reviews to the tenth above what Google shows', () => {
    expect(
      nextTenthMilestone(
        {
          reviewCount: 812,
          displayedTenths: 43,
          exact: ratio(431, 100),
          mix: ratio(470, 100),
        },
        45,
      ),
    ).toEqual({ targetTenths: 44, reviewsNeeded: 93 })
  })

  it('has none past the target', () => {
    expect(
      nextTenthMilestone(
        {
          reviewCount: 812,
          displayedTenths: 45,
          exact: ratio(45, 10),
          mix: ratio(47, 10),
        },
        45,
      ),
    ).toBeNull()
  })
})

describe('when the cache gets there before Google shows it', () => {
  it('says so while Google still shows less than the target', () => {
    expect(cacheShowsTargetFirst(ratio(4451, 1000), 44, 45)).toBe(true)
    expect(cacheShowsTargetFirst(ratio(4449, 1000), 44, 45)).toBe(false)
    expect(cacheShowsTargetFirst(ratio(4451, 1000), 45, 45)).toBe(false)
  })
})
