// "The climb, step by step" framed for the chart (round 5, PLAN-D D-2): weeks
// from today on the axis, a line where Google shows each tenth, the plan's
// start, today and the likely band named, and the caption that reads it.
import { describe, expect, it } from 'vitest'
import { climbChartModel, dayTickLabel } from './rating-goal-climb-chart-view'
import {
  DETAIL_CHANGED_PARTIAL,
  DETAIL_GOOGLE_SOURCE,
  DETAIL_HARBORLINE,
  DETAIL_LAGS,
  DETAIL_LAGS_MIDDLE,
  DETAIL_OLD_GOAL,
  DETAIL_PLAN_CHANGED,
  DETAIL_TOO_LOW,
} from './rating-goal-detail.stories.fixtures'
import {
  DETAIL_FOUND_ENDED,
  DETAIL_FOUND_REACHED,
  DETAIL_WENT_BACK,
} from './rating-goal-detail-outcomes.stories.fixtures'
import { DETAIL } from './rating-goal.stories.fixtures'

const model = (detail: Parameters<typeof climbChartModel>[0]) => {
  const framed = climbChartModel(detail)
  if (framed === null) throw new Error('expected a chart')
  return framed
}

describe('the chart’s time axis', () => {
  it('counts weeks from today, never a date', () => {
    expect(dayTickLabel(-56)).toBe('8 weeks ago')
    expect(dayTickLabel(-7)).toBe('1 week ago')
    expect(dayTickLabel(0)).toBe('Today')
    expect(dayTickLabel(56)).toBe('In 8 weeks')
  })

  it('runs from four weeks before the set to a week past where the plan meets the goal', () => {
    const framed = model(DETAIL_HARBORLINE)

    // The likely band meets 4.1 on day 28, the plan's cone on day 99.
    expect(framed.xDomain).toEqual([-51, 106])
    expect(framed.ticks).toEqual([-28, 0, 28, 56, 84])
    expect(framed.phoneTicks).toEqual([0, 56])
  })

  it('ticks every 16 weeks over a span longer than a year, every 32 on a phone', () => {
    const framed = model(DETAIL_OLD_GOAL)

    expect(framed.xDomain).toEqual([-366, 365])
    expect(framed.ticks).toEqual([-336, -224, -112, 0, 112, 224, 336])
    expect(framed.phoneTicks).toEqual([-224, 0, 224])
  })

  it('leaves out a tick too close to an end for its words to fit', () => {
    const framed = model(DETAIL_LAGS_MIDDLE)

    // Day 336 ("In 48 weeks") is 5 days from the end of [-51, 341].
    expect(framed.xDomain).toEqual([-51, 341])
    expect(framed.ticks).toEqual([0, 112, 224])
  })

  it('ticks every 8 weeks over a span longer than half a year, up to a year', () => {
    const framed = model({
      ...DETAIL_HARBORLINE,
      chart: { ...DETAIL_HARBORLINE.chart!, firstDay: -200 },
    })

    expect(framed.xDomain).toEqual([-200, 106])
    expect(framed.ticks).toEqual([-168, -112, -56, 0, 56])
    expect(framed.phoneTicks).toEqual([-112, 0])
  })
})

describe('the chart’s lines and words', () => {
  it('draws the tenths it spans, the goal’s line named as the goal', () => {
    const framed = model(DETAIL_HARBORLINE)

    expect(framed.yDomain).toEqual([3890, 4090])
    expect(framed.lines).toEqual([
      {
        thousandths: 3950,
        goal: false,
        label: 'Google shows 4.0 above this line',
        shortLabel: '4.0',
      },
      {
        thousandths: 4050,
        goal: true,
        label: 'Your goal: Google shows 4.1 above this line',
        shortLabel: 'Goal 4.1',
      },
    ])
  })

  it('keeps today and the line in view when the exact average is above the goal’s line', () => {
    const above = 4120
    const framed = model({
      ...DETAIL_LAGS,
      chart: {
        ...DETAIL_LAGS.chart!,
        history: [
          ...DETAIL_LAGS.chart!.history!.slice(0, -1),
          { day: 0, thousandths: 4135 },
        ],
        today: above,
      },
    })

    expect(framed.yDomain[1]).toBeGreaterThanOrEqual(4135)
    expect(above).toBeLessThanOrEqual(framed.yDomain[1])
    expect(framed.yDomain[1] % 10).toBe(0)
  })

  it('keeps today in view on a goal the read found reached', () => {
    const framed = model(DETAIL_FOUND_REACHED)

    expect(framed.chart.today).toBeGreaterThanOrEqual(4050)
    expect(framed.chart.today!).toBeLessThanOrEqual(framed.yDomain[1])
  })

  it('names where the plan starts, today and Google’s latest move', () => {
    const framed = model(DETAIL_HARBORLINE)

    expect(framed.anchorLabel).toBe('Plan set · 1 a day at 4.5★')
    expect(framed.anchorShortLabel).toBe('Plan set')
    expect(framed.todayLabel).toBe('Today 4.02')
    expect(framed.dots).toEqual([
      { day: -6, thousandths: 3950, up: true, label: 'Google shows 4.0' },
    ])
    expect(model(DETAIL_PLAN_CHANGED).anchorLabel).toBe('Plan changed · 1 a day at 4.5★')
  })

  it('leaves the latest move unnamed where today’s words would cover it (the list names it)', () => {
    const framed = model(DETAIL_WENT_BACK)

    expect(framed.dots).toEqual([
      { day: -14, thousandths: 3950, up: true, label: null },
      { day: -9, thousandths: 3950, up: false, label: null },
    ])
  })

  it('names the likely band with the header’s own likely words', () => {
    expect(model(DETAIL_HARBORLINE).bandLabel).toBe('4.1 likely in 2–4 weeks')
    // Between day 14 (the fast edge meets 4.05) and day 28 (the slow one).
    expect(model(DETAIL_HARBORLINE).bandAt).toEqual({ day: 21, thousandths: 4050 })
    expect(model(DETAIL_TOO_LOW).bandLabel).toBeNull()
  })

  it('sets the band’s words above the goal’s line, clear of the band', () => {
    const framed = model(DETAIL_HARBORLINE)
    const at = framed.bandAt!

    // The words sit above this point; no part of the band rises past it.
    expect(framed.chart.likely.every((point) => point.high <= at.thousandths)).toBe(true)
    expect(framed.chart.likely.some((point) => point.low < at.thousandths)).toBe(true)
  })

  it('says nothing ahead on a goal the read found reached or ended', () => {
    expect(model(DETAIL_FOUND_REACHED).bandLabel).toBeNull()
    expect(model(DETAIL_FOUND_ENDED).bandLabel).toBeNull()
    expect(model(DETAIL_FOUND_ENDED).caption).not.toMatch(/likely/u)
  })

  it('reads the climb in one caption', () => {
    expect(model(DETAIL_HARBORLINE).caption).toBe(
      'Google’s exact average went from 3.91 when you set the goal to 4.02 today. 4.1 is likely in 2–4 weeks.',
    )
    expect(model(DETAIL_TOO_LOW).caption).toBe(
      'Google’s exact average went from 3.91 when you set the goal to 4.02 today.',
    )
  })

  it('says the line is still to come while RepKey lacks some of Google’s reviews, and still reads the band', () => {
    const framed = model(DETAIL_GOOGLE_SOURCE)

    expect(framed.caption).toBe(
      'Your review cache is still filling, so Google’s exact average is not drawn yet. 4.1 is likely in 2–4 weeks.',
    )
    expect(framed.todayLabel).toBe('Today')
    expect(model(DETAIL_CHANGED_PARTIAL).chart.plan).toEqual([])
  })

  it('has no chart for a goal to keep a number', () => {
    expect(climbChartModel({ ...DETAIL, chart: null })).toBeNull()
  })
})
