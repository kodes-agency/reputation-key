// The points "Your rating on Google" is drawn through (2026-11-01): what Google showed
// on a day, the steps through Google's own numbers, the value on a day, and the day the
// goal arrives. The plot's arithmetic is in `rating-goal-line-chart-scale.test.ts`.
import { describe, expect, it } from 'vitest'
import { arrivalDay, shownOn, stepPoints, valueOn } from './rating-goal-line-chart-scale'
import { DETAIL_HARBORLINE, DETAIL_OLD_GOAL } from './rating-goal-detail.stories.fixtures'
import { DETAIL_WENT_BACK } from './rating-goal-detail-outcomes.stories.fixtures'

const CHART = DETAIL_HARBORLINE.chart!

describe('what Google showed on a day', () => {
  it('reads the exact line before the set, where the read keeps no moves', () => {
    // 3.84 is under the 3.85 at which Google shows 3.9, and over the 3.75 of 3.8.
    expect(shownOn(DETAIL_HARBORLINE, CHART, -51, 3840)).toBe(38)
    expect(shownOn(DETAIL_HARBORLINE, CHART, -51, 3912)).toBe(39)
  })

  it('reads the moves from the set on, whatever the line is', () => {
    expect(shownOn(DETAIL_HARBORLINE, CHART, -6, 3840)).toBe(40)
  })

  it('has no line to read before the set without RepKey’s full copy of the reviews', () => {
    const chart = { ...CHART, history: null }

    expect(shownOn(DETAIL_HARBORLINE, chart, -51, 3840)).toBe(39)
  })

  it('is the number it showed when the goal was set, before it moved', () => {
    expect(shownOn(DETAIL_HARBORLINE, CHART, -51)).toBe(39)
    expect(shownOn(DETAIL_HARBORLINE, CHART, -7)).toBe(39)
  })

  it('is the new number on the day it moved and after', () => {
    expect(shownOn(DETAIL_HARBORLINE, CHART, -6)).toBe(40)
    expect(shownOn(DETAIL_HARBORLINE, CHART, 0)).toBe(40)
  })

  it('follows each move, down as well as up', () => {
    const chart = DETAIL_WENT_BACK.chart!

    // Google went to 4.0 on day -14 and back to 3.9 on day -9.
    expect(shownOn(DETAIL_WENT_BACK, chart, -15)).toBe(39)
    expect(shownOn(DETAIL_WENT_BACK, chart, -14)).toBe(40)
    expect(shownOn(DETAIL_WENT_BACK, chart, -10)).toBe(40)
    expect(shownOn(DETAIL_WENT_BACK, chart, -9)).toBe(39)
    expect(shownOn(DETAIL_WENT_BACK, chart, 0)).toBe(39)
  })

  it('stays at the number of the set when Google never moved', () => {
    expect(shownOn(DETAIL_OLD_GOAL, DETAIL_OLD_GOAL.chart!, 0)).toBe(43)
  })
})

describe('the steps through Google’s own numbers', () => {
  it('stands on the line of each number Google showed, stepping up on the day it moved', () => {
    expect(stepPoints(DETAIL_HARBORLINE, CHART)).toEqual([
      { day: -51, thousandths: 3850 },
      { day: -6, thousandths: 3850 },
      { day: -6, thousandths: 3950 },
      { day: 0, thousandths: 3950 },
    ])
  })

  it('steps down as well as up', () => {
    expect(stepPoints(DETAIL_WENT_BACK, DETAIL_WENT_BACK.chart!)).toEqual([
      { day: -51, thousandths: 3850 },
      { day: -14, thousandths: 3850 },
      { day: -14, thousandths: 3950 },
      { day: -9, thousandths: 3950 },
      { day: -9, thousandths: 3850 },
      { day: 0, thousandths: 3850 },
    ])
  })

  it('is a flat line from the chart’s first day to today when Google never moved', () => {
    const chart = { ...CHART, shownChanges: [] }
    const detail = {
      ...DETAIL_HARBORLINE,
      google: { ...DETAIL_HARBORLINE.google!, shows: 3.9 },
    }

    expect(stepPoints(detail, chart)).toEqual([
      { day: -51, thousandths: 3850 },
      { day: 0, thousandths: 3850 },
    ])
  })

  it('ends at the number Google shows now, even when no move was recorded for it', () => {
    const chart = { ...CHART, shownChanges: [] }

    expect(stepPoints(DETAIL_HARBORLINE, chart).at(-1)).toEqual({
      day: 0,
      thousandths: 3950,
    })
  })

  it('ends at the last number held when Google has no number now', () => {
    const detail = { ...DETAIL_HARBORLINE, google: null }

    expect(stepPoints(detail, CHART).at(-1)).toEqual({ day: 0, thousandths: 3950 })
  })

  it('uses the chart’s own line for a number when it has one', () => {
    const chart = {
      ...CHART,
      thresholds: [
        { tenths: 39, thousandths: 3860 },
        { tenths: 40, thousandths: 3960 },
      ],
    }

    expect(
      stepPoints(DETAIL_HARBORLINE, chart).map((point) => point.thousandths),
    ).toEqual([3860, 3860, 3960, 3960])
  })

  it('works a number’s line out itself when the chart has none for it', () => {
    const chart = { ...CHART, thresholds: [] }

    expect(
      stepPoints(DETAIL_HARBORLINE, chart).map((point) => point.thousandths),
    ).toEqual([3850, 3850, 3950, 3950])
  })
})

describe('the value on a day', () => {
  const line = [
    { day: -10, thousandths: 3900 },
    { day: 0, thousandths: 4000 },
    { day: 10, thousandths: 4020 },
  ]

  it('stands on a point on its own day', () => {
    expect(valueOn(line, -10)).toBe(3900)
    expect(valueOn(line, 0)).toBe(4000)
    expect(valueOn(line, 10)).toBe(4020)
  })

  it('runs straight between two points', () => {
    expect(valueOn(line, -5)).toBe(3950)
    expect(valueOn(line, 5)).toBe(4010)
  })

  it('stays at the first point before the line starts and at the last after it ends', () => {
    expect(valueOn(line, -30)).toBe(3900)
    expect(valueOn(line, 40)).toBe(4020)
  })

  it('takes the upper end of a step on the day it climbs', () => {
    const steps = [
      { day: -10, thousandths: 3850 },
      { day: -4, thousandths: 3850 },
      { day: -4, thousandths: 3950 },
      { day: 0, thousandths: 3950 },
    ]

    expect(valueOn(steps, -5)).toBe(3850)
    expect(valueOn(steps, -4)).toBe(3950)
    expect(valueOn(steps, -2)).toBe(3950)
  })

  it('is none for a line without a point', () => {
    expect(valueOn([], 0)).toBe(0)
  })
})

describe('the day the goal arrives', () => {
  it('is the central time of an active goal that has one', () => {
    expect(arrivalDay(DETAIL_HARBORLINE)).toBe(18)
  })

  it('keeps a part of a day', () => {
    const odd = {
      ...DETAIL_HARBORLINE,
      forecast: {
        kind: 'days' as const,
        central: { num: 504, den: 27 },
        fast: { num: 400, den: 27 },
        slow: null,
      },
    }

    expect(arrivalDay(odd)).toBeCloseTo(504 / 27, 10)
  })

  it('is none once Google should show the goal', () => {
    expect(arrivalDay({ ...DETAIL_HARBORLINE, googleShowsSoon: true })).toBeNull()
  })

  it('is none for a goal that is reached or ended', () => {
    expect(arrivalDay({ ...DETAIL_HARBORLINE, state: 'reached' })).toBeNull()
    expect(arrivalDay({ ...DETAIL_HARBORLINE, state: 'ended' })).toBeNull()
  })

  it.each([
    ['no pace to count from', { kind: 'no_pace' }],
    ['no pace that gets there', { kind: 'unreachable' }],
    ['a goal the reviews have earned', { kind: 'earned' }],
  ] as const)('is none with %s', (_, forecast) => {
    expect(arrivalDay({ ...DETAIL_HARBORLINE, forecast })).toBeNull()
  })

  it('is none without a forecast', () => {
    expect(arrivalDay({ ...DETAIL_HARBORLINE, forecast: null })).toBeNull()
  })
})
