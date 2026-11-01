// The lines "Your rating on Google" draws (2026-11-01, ADR 0067): quiet before the goal
// was set and bold since, one dotted line for the way left, and the steps through
// Google's own numbers while RepKey lacks some of its reviews.
import { describe, expect, it } from 'vitest'
import type { RatingGoalChartPoint } from '#/contexts/reporting/application/dto/rating-goal.types'
import { lineChartModel, type LineChartModel } from './rating-goal-line-chart-view'
import {
  DETAIL_CHANGED_PARTIAL,
  DETAIL_GOOGLE_SOURCE,
  DETAIL_HARBORLINE,
  DETAIL_LAGS,
  DETAIL_LAGS_MIDDLE,
  DETAIL_OLD_GOAL,
  DETAIL_TOO_LOW,
} from './rating-goal-detail.stories.fixtures'
import {
  DETAIL_FOUND_ENDED,
  DETAIL_FOUND_REACHED,
} from './rating-goal-detail-outcomes.stories.fixtures'

type Detail = Parameters<typeof lineChartModel>[0]
type Chart = NonNullable<Detail['chart']>

const CHART = DETAIL_HARBORLINE.chart!

const model = (detail: Detail): LineChartModel => {
  const drawn = lineChartModel(detail)
  if (drawn === null) throw new Error('expected a chart')
  return drawn
}

/** Harborline with a part of its chart changed. */
const withChart = (
  patch: Partial<Chart>,
  detail: Detail = DETAIL_HARBORLINE,
): Detail => ({
  ...detail,
  chart: { ...detail.chart!, ...patch },
})

const line = (rows: readonly (readonly [number, number])[]): RatingGoalChartPoint[] =>
  rows.map(([day, thousandths]) => ({ day, thousandths }))

/** A forecast of the days it takes. */
const inDays = (days: number) =>
  ({
    kind: 'days',
    central: { num: days, den: 1 },
    fast: { num: days, den: 1 },
    slow: null,
  }) as const

describe('before and since the goal was set', () => {
  /** A line of five points whose goal was set on its third. */
  const FIVE = withChart({
    firstDay: -40,
    setDay: -20,
    history: line([
      [-40, 3900],
      [-30, 3900],
      [-20, 3920],
      [-10, 3950],
      [0, 4000],
    ]),
    today: 4000,
    shownChanges: [],
  })

  const points = (path: string | null): number => (path?.match(/[ML]/gu) ?? []).length

  it('draws the way before the set as one line and the way since as another', () => {
    const drawn = model(FIVE)

    // Before: the two weeks before the set and the set itself. Since: the set and two more.
    expect(points(drawn.before)).toBe(3)
    expect(points(drawn.since)).toBe(3)
  })

  it('meets at the set: the line before ends where the line since begins', () => {
    const drawn = model(FIVE)
    const set = drawn.set!

    expect(drawn.before?.endsWith(`L${set.x} ${set.y}`)).toBe(true)
    expect(drawn.since.startsWith(`M${set.x} ${set.y}`)).toBe(true)
  })

  it('stands the set’s point at the line’s value on the day it was set', () => {
    const drawn = model(FIVE)

    // 3.92 on day -20 is higher than the 3.90 of the weeks before it, on the same scale.
    expect(drawn.set!.y).toBeLessThan(drawn.stops[0]!.y)
    expect(drawn.set!.y).toBe(drawn.stops[2]!.y)
  })

  it('starts the line before at the chart’s first point and the line since at the set', () => {
    const drawn = model(FIVE)

    expect(drawn.before?.startsWith('M0 ')).toBe(true)
    expect(drawn.since.startsWith('M0 ')).toBe(false)
  })

  it('washes the way since, down to the floor and back to the set', () => {
    const drawn = model(FIVE)

    expect(drawn.wash).toBe(`${drawn.since}L${drawn.today.x} 100L${drawn.set!.x} 100Z`)
  })

  it('names the day the goal was set at its point', () => {
    expect(model(FIVE).set).toMatchObject({ words: 'Goal set, Sep 24' })
    expect(model(withChart({ setDay: -19 }, FIVE)).set).toMatchObject({
      words: 'Goal set, Sep 25',
    })
  })

  it('draws nothing before the set for a goal set before the chart starts', () => {
    const drawn = model(withChart({ setDay: -400 }, FIVE))

    expect(drawn.before).toBeNull()
    expect(drawn.set).toBeNull()
    // The whole line is since the set, from its first point.
    expect(points(drawn.since)).toBe(5)
    expect(drawn.since.startsWith('M0 ')).toBe(true)
  })

  it('draws nothing before the set for a goal set on the chart’s first day', () => {
    const drawn = model(withChart({ setDay: -40 }, FIVE))

    expect(drawn.before).toBeNull()
    expect(drawn.set).toBeNull()
    expect(points(drawn.since)).toBe(5)
  })

  it('draws the whole line before the set, and no line since, for a goal set today', () => {
    const drawn = model(withChart({ setDay: 0 }, FIVE))

    expect(points(drawn.before)).toBe(5)
    expect(points(drawn.since)).toBe(1)
    expect(drawn.wash).toBeNull()
  })

  it('puts the words of the set above its point near the floor of the chart, else under it', () => {
    // Harborline sits mid-chart; the partial cache's flat steps lie on the floor's own line.
    expect(model(DETAIL_HARBORLINE).set).toMatchObject({ above: false })
    expect(model(DETAIL_GOOGLE_SOURCE).set).toMatchObject({ above: true })
  })

  it('puts the words of the set to the right of its point until it nears the right edge', () => {
    expect(model(DETAIL_HARBORLINE).set).toMatchObject({ side: 'right' })

    // With no arrival the chart ends a few days past today, so day -2 is nearly at its edge.
    const late = model({
      ...withChart({ setDay: -2 }, DETAIL_LAGS),
    })

    expect(late.set).toMatchObject({ side: 'left' })
  })
})

describe('the dotted line to the goal', () => {
  it('runs from today to the goal’s line, at the day the goal arrives, when that fits', () => {
    const drawn = model(DETAIL_HARBORLINE)

    expect(drawn.ahead?.startsWith(`M${drawn.today.x} ${drawn.today.y}`)).toBe(true)
    expect(drawn.arrival).toEqual({ x: expect.any(Number), y: drawn.goalY })
    expect(drawn.ahead?.endsWith(`L${drawn.arrival!.x} ${drawn.goalY}`)).toBe(true)
    expect(drawn.arrival!.x).toBeGreaterThan(drawn.today.x)
  })

  it('says when, above the goal’s line, with no arrow while the whole way fits', () => {
    expect(model(DETAIL_HARBORLINE).aheadWords).toBe('4.1 in about 3 weeks')
  })

  describe('with an arrival far past the chart’s past', () => {
    // 330 days to go, 56 days of past: the way does not fit and runs off the edge.
    const far = model({
      ...DETAIL_HARBORLINE,
      forecast: inDays(330),
      chart: {
        ...CHART,
        firstDay: -56,
        history: line([
          [-56, 3910],
          [-28, 3912],
          [-20, 3912],
          [-7, 3950],
          [0, 3979],
        ]),
        today: 3979,
        shownChanges: [{ day: -7, tenths: 40, up: true }],
      },
    })

    it('runs off the right edge of the chart', () => {
      expect(far.ahead?.startsWith(`M${far.today.x} ${far.today.y}`)).toBe(true)
      expect(far.ahead).toMatch(/L100 [\d.]+$/u)
    })

    it('stops short of the goal’s line, which it has not reached', () => {
      const endsAt = Number(far.ahead?.split(' ').at(-1))

      expect(endsAt).toBeGreaterThan(far.goalY)
      expect(endsAt).toBeLessThan(far.today.y)
    })

    it('draws no arrival dot on the goal’s line', () => {
      expect(far.arrival).toBeNull()
    })

    it('puts an arrow in its words', () => {
      expect(far.aheadWords).toBe('4.1 in about 11 months →')
    })
  })

  it('puts an arrow in the words of a goal more than three years away', () => {
    const drawn = model({ ...DETAIL_HARBORLINE, forecast: inDays(1200) })

    expect(drawn.aheadWords).toBe('4.1 is more than 3 years away →')
    expect(drawn.arrival).toBeNull()
  })

  it('runs off the chart for a long climb on a short past, with the arrow', () => {
    // Harborline's neighbour: 180 days to the goal, 51 days of past.
    const drawn = model(DETAIL_LAGS_MIDDLE)

    expect(drawn.arrival).toBeNull()
    expect(drawn.aheadWords).toBe('4.5 in about 6 months →')
    expect(drawn.ahead).toMatch(/L100 [\d.]+$/u)
  })

  it('fits a climb of 330 days on a past of a year, which the chart reaches whole', () => {
    const drawn = model(DETAIL_OLD_GOAL)

    expect(drawn.arrival).not.toBeNull()
    expect(drawn.aheadWords).toBe('4.5 in about 11 months')
  })

  it.each([
    ['a goal reached', DETAIL_FOUND_REACHED],
    ['a goal ended', DETAIL_FOUND_ENDED],
    ['new reviews too low', DETAIL_TOO_LOW],
    ['Google about to show the goal', DETAIL_LAGS],
    [
      'no pace to work out a time',
      { ...DETAIL_HARBORLINE, forecast: { kind: 'no_pace' } },
    ],
  ] as const)('is not drawn with %s', (_, detail) => {
    const drawn = model(detail)

    expect(drawn.ahead).toBeNull()
    expect(drawn.arrival).toBeNull()
    expect(drawn.aheadWords).toBeNull()
  })

  it('is not drawn for an arrival that is today, which has no way left', () => {
    const drawn = model({ ...DETAIL_HARBORLINE, forecast: inDays(0) })

    expect(drawn.ahead).toBeNull()
  })
})

describe('when RepKey lacks some of Google’s reviews', () => {
  const drawn = model(DETAIL_GOOGLE_SOURCE)
  const lineFor = (label: string) =>
    drawn.grid.find((gridLine) => gridLine.label === label)

  it('steps through Google’s own numbers instead, a step on the day each one moved', () => {
    // The 3.9 line to day -6 (62.5 across), up to the 4.0 line, and on to today.
    expect(drawn.since).toBe(
      `M${drawn.set!.x} ${lineFor('3.9')!.y}L62.5 ${lineFor('3.9')!.y}L62.5 ${lineFor('4.0')!.y}L${drawn.today.x} ${lineFor('4.0')!.y}`,
    )
  })

  it('stands today on the line of the number Google shows', () => {
    expect(drawn.today.y).toBe(lineFor('4.0')!.y)
    expect(drawn.today.words).toBe('Today 4.0')
  })

  it('stands the way before the set on the line of the number it showed then', () => {
    expect(drawn.set!.y).toBe(lineFor('3.9')!.y)
  })

  it('keeps the dotted line to the goal', () => {
    expect(drawn.ahead).not.toBeNull()
    expect(drawn.aheadWords).toBe('4.1 in about 3 weeks')
  })

  it('steps the same through a changed plan', () => {
    expect(model(DETAIL_CHANGED_PARTIAL).since).toBe(drawn.since)
  })

  it('gives every readout its own key, though a step is two points on one day', () => {
    const keys = drawn.stops.map((stop) => stop.key)

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('says each step once in its readouts, not once for each of its two points', () => {
    const lines = drawn.stops.map((stop) => stop.line)

    expect(new Set(lines).size).toBe(lines.length)
  })
})
