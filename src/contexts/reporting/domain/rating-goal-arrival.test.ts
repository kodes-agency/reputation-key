import { describe, expect, it } from 'vitest'
import { ratio, type Ratio } from './rating-goal-numbers'
import {
  actualRate,
  arrivalDays,
  chosenRate,
  earnedTenths,
  nextNumber,
  nextUpAbove,
  type Arrival,
  type DayFraction,
} from './rating-goal-arrival'

const numbers = (reviewCount: number, sum: number, displayedTenths: number) => ({
  reviewCount,
  displayedTenths,
  exact: ratio(sum, reviewCount),
})

/** The plan's worked example at the set: 261 reviews at 3.912, Google shows 3.9. */
const HARBORLINE = numbers(261, 1021, 39)
/** 28 reviews summing 129 later: 289 reviews at 3.979, Google shows 4.0. */
const HARBORLINE_28 = numbers(289, 1150, 40)
/** The plan's 4.5★ blended with those 28 reviews, the plan counted as 15: 1965 / 430. */
const BLENDED_28: Ratio = ratio(15 * 45 + 10 * 129, 10 * (15 + 28))

const asNumber = (days: DayFraction): number => days.num / days.den

/** The three ends of an arrival in days, to two decimals. */
function inDays(arrival: Arrival) {
  if (arrival.kind !== 'days') throw new Error(`expected days, got ${arrival.kind}`)
  return {
    central: Number(asNumber(arrival.central).toFixed(2)),
    fast: Number(asNumber(arrival.fast).toFixed(2)),
    slow: arrival.slow === null ? null : Number(asNumber(arrival.slow).toFixed(2)),
  }
}

describe('when a goal arrives, in days', () => {
  it('reproduces the setup at the set (Harborline 4.1 at 1 a day, 4.5★)', () => {
    const arrival = arrivalDays(HARBORLINE, 41, ratio(45, 10), chosenRate(70))

    expect(inDays(arrival)).toEqual({ central: 81, fast: 60, slow: 114.44 })
  })

  it('works the blended average out at the chosen pace after 28 reviews', () => {
    // need 40 at 4.5698, 33 at 4.6698 and 49 at 4.4698.
    const arrival = arrivalDays(HARBORLINE_28, 41, BLENDED_28, chosenRate(70))

    expect(inDays(arrival)).toEqual({ central: 40, fast: 30, slow: 54.44 })
  })

  it('counts the actual pace as reviews in the last 28 days', () => {
    const arrival = arrivalDays(HARBORLINE_28, 41, BLENDED_28, actualRate(28))

    expect(inDays(arrival)).toEqual({ central: 40, fast: 30, slow: 54.44 })
  })

  it('works Google’s own figure out when the cache is short of its count', () => {
    // Google's 3.9 (stored as 3.9000000953674316) is read as 3.9 exactly.
    const google = { reviewCount: 261, displayedTenths: 39, exact: ratio(39, 10) }

    const arrival = arrivalDays(google, 41, ratio(45, 10), chosenRate(70))

    expect(inDays(arrival)).toEqual({ central: 87, fast: 65.45, slow: 124.44 })
  })

  it('reaches nothing while new reviews average no more than the threshold', () => {
    // Ten reviews since the set averaging 4.0, at or below 4.05.
    const arrival = arrivalDays(numbers(271, 1061, 39), 41, ratio(40, 10), chosenRate(70))

    expect(arrival).toEqual({ kind: 'unreachable' })
  })

  it('says there is no pace before anything else', () => {
    expect(arrivalDays(HARBORLINE, 41, ratio(45, 10), actualRate(0))).toEqual({
      kind: 'no_pace',
    })
  })

  it('needs no review when the cache already clears the goal and Google lags', () => {
    const lagging = numbers(100, 412, 40)

    expect(arrivalDays(lagging, 41, ratio(45, 10), chosenRate(70))).toEqual({
      kind: 'earned',
    })
  })

  it('leaves the slow end open when 0.1★ less no longer clears the goal by 0.15★', () => {
    // 4.65 − 0.1 = 4.55 is below 4.6, the least a plan for 4.5 may assume.
    const arrival = arrivalDays(
      numbers(812, 3500, 43),
      45,
      ratio(465, 100),
      chosenRate(110),
    )

    expect(arrival).toMatchObject({ kind: 'days', slow: null })
  })

  it('never works the fast end out above five stars', () => {
    // At 5.0, 4.8 from 100 reviews at 4.70 needs 20; 5.1 would ask for 15.
    const arrival = arrivalDays(numbers(100, 470, 47), 48, ratio(5, 1), chosenRate(10))

    expect(inDays(arrival).fast).toBeCloseTo((20 * 70 * 100) / (10 * 110), 2)
  })

  it('works the middle-lag goal out to the goal itself (shown 4.3, exact 4.36, goal 4.5)', () => {
    const arrival = arrivalDays(numbers(500, 2180, 43), 45, ratio(47, 10), chosenRate(70))

    expect(inDays(arrival)).toEqual({ central: 180, fast: 117.27, slow: 333.33 })
  })
})

describe('the next one up after the goal', () => {
  it('is possible in about six months for Harborline (4.2: 178 reviews, 97 beyond 4.1)', () => {
    const up = nextUpAbove(HARBORLINE, 41, ratio(45, 10), chosenRate(70))

    expect(up).toMatchObject({ targetTenths: 42, total: 178, beyond: 97 })
    expect(asNumber(up!.days)).toBe(178)
  })

  it('follows the blended average (4.2: 118 in all, 78 beyond)', () => {
    const up = nextUpAbove(HARBORLINE_28, 41, BLENDED_28, chosenRate(70))

    expect(up).toMatchObject({ targetTenths: 42, total: 118, beyond: 78 })
  })

  it('is not offered when the average does not clear it by 0.15★', () => {
    expect(nextUpAbove(HARBORLINE, 41, ratio(42, 10), chosenRate(70))).toBeNull()
  })

  it('is not offered above 4.9 nor without a pace', () => {
    expect(nextUpAbove(numbers(100, 480, 48), 49, ratio(5, 1), chosenRate(70))).toBeNull()
    expect(nextUpAbove(HARBORLINE, 41, ratio(45, 10), actualRate(0))).toBeNull()
  })
})

describe('the number a card counts to', () => {
  it('is the tenth above what Google shows while it is short of the goal', () => {
    expect(nextNumber(numbers(812, 3500, 43), 45)).toEqual({
      targetTenths: 44,
      soonTenths: null,
    })
  })

  it('is the goal when it is the next tenth', () => {
    expect(nextNumber(HARBORLINE_28, 41)).toEqual({ targetTenths: 41, soonTenths: null })
  })

  it('skips a tenth Google should show soon (shown 4.3, exact 4.36, goal 4.5)', () => {
    // Never "0 new reviews to 4.4": the cache already clears 4.35.
    expect(nextNumber(numbers(500, 2180, 43), 45)).toEqual({
      targetTenths: 45,
      soonTenths: 44,
    })
  })

  it('is none once the reviews have earned the goal and Google lags', () => {
    expect(nextNumber(numbers(100, 412, 40), 41)).toBeNull()
  })
})

describe('what Google has already earned', () => {
  it('is the shown tenth while the cache is below the next threshold', () => {
    expect(earnedTenths(HARBORLINE)).toBe(39)
  })

  it('is the highest tenth the cache already clears while Google lags (3.96 shows 3.9)', () => {
    expect(earnedTenths(numbers(100, 396, 39))).toBe(40)
  })

  it('reaches 5.0 when every review is five stars', () => {
    expect(earnedTenths(numbers(20, 100, 49))).toBe(50)
  })
})
