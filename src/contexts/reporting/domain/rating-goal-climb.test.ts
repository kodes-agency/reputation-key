import { describe, expect, it } from 'vitest'
import {
  averageAfter,
  initialPlan,
  likelyBand,
  perMonthOf28Days,
  planCone,
} from './rating-goal-climb'
import { ratio } from './rating-goal-numbers'

// Harborline at the set: 261 reviews summing 1,021 (3.912), goal 4.1 (shows
// from 4.05), planned 4.5★ at 1 a day.
const HARBORLINE = { reviewCount: 261, exact: ratio(1021, 261) }

describe('averageAfter', () => {
  it('reaches the threshold after the reviews the goal needs, and not one sooner', () => {
    // need(4.1) at 4.5★ is 81 (PLAN-D §2): 1,385.5 / 342 = 4.0512.
    expect(averageAfter(261, ratio(1021, 261), ratio(81, 1), ratio(9, 2))).toEqual(
      ratio(2771, 684),
    )
    // 80 leave it at 1,381 / 341 = 4.0499, under 4.05.
    expect(averageAfter(261, ratio(1021, 261), ratio(80, 1), ratio(9, 2))).toEqual(
      ratio(1381, 341),
    )
  })

  it('takes a fraction of a review, as a pace brings in a few days', () => {
    // 7.7 reviews at 4.6★: (1,021 + 35.42) / 268.7.
    expect(averageAfter(261, ratio(1021, 261), ratio(77, 10), ratio(23, 5))).toEqual(
      ratio(105642, 26870),
    )
  })
})

describe('planCone', () => {
  const setFourWeeksAgo = {
    start: { ...HARBORLINE, day: -28 },
    qualityTenths: 45,
    paceTenthsPerWeek: 70,
    targetTenths: 41,
    firstDay: -56,
  }

  it('draws the plan weekly from the set, 4.6★ at 10% more above and 4.4★ at 10% less below', () => {
    const cone = planCone(setFourWeeksAgo)

    expect(cone[0]).toEqual({ day: -28, low: 3912, high: 3912 })
    // A week in: 7.7 reviews at 4.6★ → 3.9316; 6.3 at 4.4★ → 3.9234.
    expect(cone[1]).toEqual({ day: -21, low: 3923, high: 3932 })
    // Today, four weeks in: 3.98451 → 3.985 (half up); 3.95486 → 3.955.
    expect(cone.find((point) => point.day === 0)).toEqual({
      day: 0,
      low: 3955,
      high: 3985,
    })
  })

  it('stops rising at the goal’s threshold', () => {
    const cone = planCone(setFourWeeksAgo)

    // Eight weeks in: 50.4 at 4.4★ → 3.9909; 61.6 at 4.6★ → 4.0433. The high
    // edge crosses 4.05 after 65.5 reviews (59.6 days), the low one later.
    expect(cone.find((point) => point.day === 28)).toEqual({
      day: 28,
      low: 3991,
      high: 4043,
    })
    expect(cone.find((point) => point.day === 35)?.high).toBe(4050)
    expect(Math.max(...cone.map((point) => point.high))).toBe(4050)
  })

  it('runs half a year from a recent start, weekly', () => {
    const cone = planCone(setFourWeeksAgo)

    expect(cone).toHaveLength(27)
    expect(cone.at(-1)?.day).toBe(154)
  })

  it('runs to today from a start more than half a year ago, and leaves out what the chart does not show', () => {
    const cone = planCone({
      ...setFourWeeksAgo,
      start: { ...HARBORLINE, day: -200 },
      firstDay: -100,
    })

    expect(cone[0]?.day).toBe(-95)
    expect(cone.at(-2)?.day).toBe(-4)
    expect(cone.at(-1)?.day).toBe(0)
  })

  it('runs a year at most', () => {
    const cone = planCone({
      ...setFourWeeksAgo,
      start: { ...HARBORLINE, day: -400 },
      firstDay: -400,
    })

    expect(cone.at(-1)?.day).toBe(-35)
  })

  it('never plans the better edge above five stars', () => {
    const cone = planCone({ ...setFourWeeksAgo, qualityTenths: 50, targetTenths: 49 })

    // A week in: 7.7 reviews at 5★ (not 5.1★) → (1,021 + 38.5) / 268.7 = 3.9431.
    expect(cone[1]?.high).toBe(3943)
  })
})

describe('likelyBand', () => {
  const atTheSet = {
    ...HARBORLINE,
    targetTenths: 41,
    mix: ratio(9, 2),
    rate: { reviews: 70, perDays: 70 },
  }

  it('starts today and drifts as the arrival does: 0.1★ and 10% each way', () => {
    const band = likelyBand({ ...atTheSet, slow: { num: 72100, den: 630 } })

    expect(band[0]).toEqual({ day: 0, low: 3912, high: 3912 })
    expect(band[1]).toEqual({ day: 7, low: 3923, high: 3932 })
  })

  it('runs to the slow end, at least half a year, and meets the goal’s line', () => {
    // Slow end 114.4 days: shorter than half a year, so 182 days.
    const band = likelyBand({ ...atTheSet, slow: { num: 72100, den: 630 } })

    expect(band.at(-1)).toEqual({ day: 182, low: 4050, high: 4050 })
    expect(band).toHaveLength(27)
  })

  it('runs a year when the slow end is open', () => {
    const band = likelyBand({ ...atTheSet, slow: null })

    expect(band.at(-2)?.day).toBe(364)
    expect(band.at(-1)?.day).toBe(365)
  })

  it('runs past half a year to a later slow end, and a year at most', () => {
    expect(likelyBand({ ...atTheSet, slow: { num: 2001, den: 10 } }).at(-1)?.day).toBe(
      201,
    )
    expect(likelyBand({ ...atTheSet, slow: { num: 9000, den: 10 } }).at(-1)?.day).toBe(
      365,
    )
  })

  it('moves at the actual pace when the arrival does', () => {
    // 28 reviews in 28 days is one a day: the same band as 1 a day chosen.
    const actual = likelyBand({
      ...atTheSet,
      rate: { reviews: 28, perDays: 28 },
      slow: null,
    })
    const chosen = likelyBand({ ...atTheSet, slow: null })

    expect(actual).toEqual(chosen)
  })
})

describe('perMonthOf28Days', () => {
  it('turns four weeks of reviews into a whole number a month, half up', () => {
    expect(perMonthOf28Days(2)).toBe(2)
    expect(perMonthOf28Days(7)).toBe(8)
    expect(perMonthOf28Days(13)).toBe(14)
    expect(perMonthOf28Days(0)).toBe(0)
  })
})

describe('initialPlan', () => {
  const current = { targetTenths: 42, paceTenthsPerWeek: 140 }

  it('is the plan as it stands when nothing changed', () => {
    expect(initialPlan(current, [])).toEqual(current)
  })

  it('takes each field’s first old value', () => {
    expect(
      initialPlan(current, [
        { field: 'target', oldValue: '41' },
        { field: 'pace', oldValue: '70' },
      ]),
    ).toEqual({ targetTenths: 41, paceTenthsPerWeek: 70 })
  })

  it('has no pace when the goal was set to keep a number', () => {
    expect(
      initialPlan(current, [
        { field: 'mode', oldValue: 'keep' },
        { field: 'pace', oldValue: null },
      ]),
    ).toEqual({ targetTenths: 42, paceTenthsPerWeek: null })
  })

  it('keeps the target it has when a logged one is unreadable', () => {
    expect(initialPlan(current, [{ field: 'target', oldValue: 'x' }])).toEqual(current)
  })
})
