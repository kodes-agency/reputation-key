import { describe, expect, it } from 'vitest'
import {
  FORECAST_MIX_DRIFT_THOUSANDTHS,
  FORECAST_PACE_DRIFT_PERCENT,
} from './rating-goal-forecast'
import { ratio } from './rating-goal-numbers'
import { paceChips } from './rating-goal-pace-chips'
import {
  SIX_MONTHS_DAYS,
  daysAt,
  earnedTenths,
  fasterPaceChip,
  likelyDays,
  recommendedGoal,
  withinDays,
} from './rating-goal-duration'

const numbers = (reviewCount: number, sum: number, displayedTenths: number) => ({
  reviewCount,
  displayedTenths,
  exact: ratio(sum, reviewCount),
})

const HARBORLINE = numbers(261, 1021, 39)
const OLIVE_TREE = numbers(60, 251, 42)
const SEAVIEW = numbers(640, 2707, 42)
const TAVOLA = numbers(2100, 9492, 45)

const asNumber = (fraction: Readonly<{ num: number; den: number }>) =>
  fraction.num / fraction.den

describe('days at a pace', () => {
  it('is reviews × 70 over the pace in tenths a week, as a fraction', () => {
    expect(daysAt(81, 70)).toEqual({ num: 5670, den: 70 })
    expect(asNumber(daysAt(220, 140))).toBe(110)
  })

  it('counts exactly six months as within six months', () => {
    expect(SIX_MONTHS_DAYS).toBe(182)
    expect(withinDays(182, 70, SIX_MONTHS_DAYS)).toBe(true)
    expect(withinDays(183, 70, SIX_MONTHS_DAYS)).toBe(false)
    expect(withinDays(26, 10, SIX_MONTHS_DAYS)).toBe(true)
  })
})

describe('the drift the likely range allows', () => {
  it('is a tenth of a star and 10% of the pace, the forecast’s own constants', () => {
    expect(FORECAST_MIX_DRIFT_THOUSANDTHS).toBe(100)
    expect(FORECAST_PACE_DRIFT_PERCENT).toBe(10)
  })
})

describe('the recommended goal', () => {
  it.each([
    ['Harborline', HARBORLINE, 40, 45, 70, 41],
    ['Olive Tree', OLIVE_TREE, 43, 46, 70, 44],
    ['Seaview', SEAVIEW, 43, 47, 140, 44],
    ['Tavola', TAVOLA, 46, 48, 490, 46],
  ] as const)(
    'is the highest within six months at 0.1★ below plan (%s)',
    (_name, figures, min, quality, pace, goal) => {
      expect(recommendedGoal(figures, min, quality, pace)).toEqual({
        targetTenths: goal,
        safe: true,
      })
    },
  )

  it('is the lowest goal, not safe, when none is within six months (4.6 at 4.8★, 1 a day)', () => {
    expect(recommendedGoal(numbers(500, 2300, 46), 47, 48, 70)).toEqual({
      targetTenths: 47,
      safe: false,
    })
  })

  it('keeps looking past a goal that is too far while higher ones are reachable', () => {
    // At 3★ planned the next tenth is slow but the scan does not stop there.
    expect(recommendedGoal(HARBORLINE, 40, 45, 3500).targetTenths).toBe(43)
  })
})

describe('the likely range', () => {
  it('runs from 0.1★ better and 10% faster to 0.1★ worse and 10% slower (Harborline 4.1)', () => {
    const likely = likelyDays(HARBORLINE, 41, 45, 70)
    expect(asNumber(likely.fast)).toBe(60)
    expect(asNumber(likely.slow ?? { num: 0, den: 1 })).toBeCloseTo(114.44, 2)
  })

  it.each([
    ['Olive Tree', OLIVE_TREE, 44, 46, 70, 26.4, 74.4],
    ['Seaview', SEAVIEW, 44, 47, 140, 78.2, 171.1],
    ['Tavola', TAVOLA, 46, 48, 490, 23.4, 66.7],
  ] as const)(
    'reproduces the approved ends (%s)',
    (_name, figures, goal, quality, pace, fast, slow) => {
      const likely = likelyDays(figures, goal, quality, pace)
      expect(asNumber(likely.fast)).toBeCloseTo(fast, 1)
      expect(asNumber(likely.slow ?? { num: 0, den: 1 })).toBeCloseTo(slow, 1)
    },
  )

  it('leaves the slow end open when 0.1★ less no longer reaches the goal', () => {
    expect(likelyDays(numbers(500, 2300, 46), 47, 48, 70).slow).toBeNull()
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

describe('the faster pace the status suggests', () => {
  const chips = paceChips(6, 3).chips // 30, 70, 140, 210, 350

  it('is the first faster chip that gets there within six months', () => {
    expect(fasterPaceChip(300, 70, chips)).toBe(2)
  })

  it('is the fastest chip when none gets there within six months', () => {
    expect(fasterPaceChip(2000, 70, chips)).toBe(4)
  })

  it('is none within six months, or when no chip is faster', () => {
    expect(fasterPaceChip(81, 70, chips)).toBeNull()
    expect(fasterPaceChip(2000, 350, chips)).toBeNull()
  })
})
