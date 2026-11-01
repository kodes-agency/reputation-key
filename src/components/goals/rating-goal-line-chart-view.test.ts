// "Your rating on Google" on the Google rating goal's page (2026-11-01, ADR 0067): the
// tenths up the side, and the words. Google's exact average (4.02) is worked from but
// never printed: every word is a one-decimal number, and each tenth's line sits at the
// average at which Google shows it. The paths are in `rating-goal-line-chart-paths.test.ts`,
// the words beside the points in `rating-goal-line-chart-words.test.ts`.
import { describe, expect, it } from 'vitest'
import type { RatingGoalChartPoint } from '#/contexts/reporting/application/dto/rating-goal.types'
import { lineChartModel, type LineChartModel } from './rating-goal-line-chart-view'
import {
  DETAIL_GOOGLE_SOURCE,
  DETAIL_HARBORLINE,
  DETAIL_LAGS,
  DETAIL_LAGS_MIDDLE,
  DETAIL_OLD_GOAL,
  DETAIL_TOO_LOW,
} from './rating-goal-detail.stories.fixtures'
import {
  DETAIL_FOUND_REACHED,
  DETAIL_WENT_BACK,
} from './rating-goal-detail-outcomes.stories.fixtures'
import { DETAIL } from './rating-goal.stories.fixtures'

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

/** A line from `lowest` up to 4.1, on a chart that carries a line for each tenth from 3.8 to 4.5, to a goal of 4.5. */
const climbingTo45 = (lowest: number): Detail =>
  withChart(
    {
      history: line([
        [-51, lowest],
        [0, 4100],
      ]),
      thresholds: Array.from({ length: 8 }, (_, index) => ({
        tenths: 38 + index,
        thousandths: (38 + index) * 100 - 50,
      })),
      today: 4100,
    },
    { ...DETAIL_HARBORLINE, targetTenths: 45, target: 4.5, threshold: 4.45 },
  )

/** Harborline's line with its last point (today) moved. */
const endingAt = (thousandths: number): Partial<Chart> => ({
  history: [...CHART.history!.slice(0, -1), { day: 0, thousandths }],
  today: thousandths,
})

/** A forecast of the days it takes. */
const inDays = (days: number) =>
  ({
    kind: 'days',
    central: { num: days, den: 1 },
    fast: { num: days, den: 1 },
    slow: null,
  }) as const

/** Every word the chart prints, for a manager's eye or a screen reader's. */
function allWords(chart: LineChartModel): string[] {
  return [
    chart.sentence,
    chart.goalLabel,
    chart.aheadWords,
    chart.today.words,
    chart.set?.words,
    ...chart.moves.map((move) => move.words?.words),
    ...chart.grid.map((gridLine) => gridLine.label),
    ...chart.months.map((month) => month.label),
    ...chart.stops.map((stop) => stop.line),
  ].filter((words): words is string => typeof words === 'string')
}

describe('a goal with no line to draw', () => {
  it('draws none for a goal to keep a number, which has no chart', () => {
    expect(lineChartModel(DETAIL)).toBeNull()
    expect(lineChartModel({ ...DETAIL_HARBORLINE, mode: 'keep', chart: null })).toBeNull()
  })

  it('draws none when the line has no point to start from', () => {
    expect(lineChartModel(withChart({ history: [] }))).toBeNull()
  })
})

describe('the tenths up the side', () => {
  it('draws a line for each tenth from the one under the lowest point up to the goal', () => {
    const drawn = model(DETAIL_HARBORLINE)

    // The line is 3.91 at its lowest and the chart carries 3.8 to 4.2: 3.8 and 4.2 stay out.
    expect(drawn.grid.map((gridLine) => gridLine.label)).toEqual(['3.9', '4.0'])
    expect(drawn.goalLabel).toBe('4.1')
  })

  it('draws the goal’s own line apart from the others, above them', () => {
    const drawn = model(DETAIL_HARBORLINE)

    expect(drawn.goalY).toBeLessThan(
      Math.min(...drawn.grid.map((gridLine) => gridLine.y)),
    )
    expect(drawn.grid.map((gridLine) => gridLine.label)).not.toContain('4.1')
  })

  it('draws the lower number lower', () => {
    const [lower, higher] = model(DETAIL_HARBORLINE).grid

    expect(lower!.y).toBeGreaterThan(higher!.y)
  })

  it('keeps a line above the goal when the exact average has gone past it', () => {
    // 4.16 is past 4.15, where Google shows 4.2.
    const past = model(withChart(endingAt(4160)))

    expect(past.grid.map((gridLine) => gridLine.label)).toEqual(['3.9', '4.0', '4.2'])
  })

  it('names every line while there are six or fewer, the goal’s among them', () => {
    // From 3.99 the lines are 4.0 to 4.5: six, so each is named.
    const six = model(climbingTo45(3990))

    expect(six.grid.map((gridLine) => gridLine.label)).toEqual([
      '4.0',
      '4.1',
      '4.2',
      '4.3',
      '4.4',
    ])
  })

  it('names every other line past six lines, so their numbers never touch', () => {
    // From 3.89 the lines are 3.9 to 4.5: seven, so every other grid line is named.
    const seven = model(climbingTo45(3890))

    expect(seven.grid.map((gridLine) => gridLine.label)).toEqual([
      '3.9',
      null,
      '4.1',
      null,
      '4.3',
      null,
    ])
  })

  it('draws the goal’s line from the card’s threshold when the chart carries none for it', () => {
    const drawn = model(withChart({ thresholds: [] }))

    expect(drawn.goalLabel).toBe('4.1')
    expect(drawn.grid).toEqual([])
    expect(drawn.goalY).toBeGreaterThan(0)
    expect(drawn.goalY).toBeLessThan(drawn.today.y)
  })
})

describe('no exact average in any word', () => {
  it('prints no number with more than one decimal, in the sentence, the lines or the readouts', () => {
    const words = allWords(model(DETAIL_HARBORLINE))

    expect(words.filter((printed) => /\d\.\d{2,}/u.test(printed))).toEqual([])
  })

  it('says 4.0 for an exact average of 4.02', () => {
    const drawn = model(DETAIL_HARBORLINE)

    expect(CHART.today).toBe(4020)
    expect(drawn.sentence).toContain('shows 4.0 today')
    expect(drawn.sentence).not.toContain('4.02')
    expect(drawn.today.words).toBe('Today 4.0')
    expect(drawn.stops.at(-1)?.line).toBe('Today · Google shows 4.0')
    expect(allWords(drawn).join(' ')).not.toContain('4.02')
    expect(allWords(drawn).join(' ')).not.toContain('3.91')
  })

  it('reads today as the number Google shows, which a goal reached has just moved to', () => {
    const drawn = model(DETAIL_FOUND_REACHED)

    expect(drawn.today.words).toBe('Today 4.1')
    expect(drawn.stops.at(-1)?.line).toBe('Today · Google shows 4.1')
    expect(drawn.stops.at(-2)?.line).toBe('Oct 12 · Google showed 4.0')
  })

  it('names the number Google shows, not the tenth the exact average would round to', () => {
    // 4.061 rounds to 4.1, but Google still shows 4.0.
    const drawn = model(DETAIL_LAGS)

    expect(drawn.today.words).toBe('Today 4.0')
    expect(drawn.stops.at(-1)?.line).toBe('Today · Google shows 4.0')
    expect(drawn.sentence).toContain('shows 4.0 today')
  })

  it.each([
    ['Harborline', DETAIL_HARBORLINE],
    ['Google should show the goal soon', DETAIL_LAGS],
    ['a goal reached', DETAIL_FOUND_REACHED],
    ['a goal Google went back on', DETAIL_WENT_BACK],
    ['a goal of 200 days', DETAIL_OLD_GOAL],
    ['a goal far from its time', DETAIL_LAGS_MIDDLE],
    ['a cache that lacks some reviews', DETAIL_GOOGLE_SOURCE],
  ])('prints only one-decimal numbers for %s', (_, detail) => {
    const words = allWords(model(detail))

    expect(words.filter((printed) => /\d\.\d{2,}/u.test(printed))).toEqual([])
  })

  it('says every readout as what Google showed or shows, with the day', () => {
    const readouts = model(DETAIL_HARBORLINE).stops.map((stop) => stop.line)

    expect(readouts[0]).toBe('Aug 24 · Google showed 3.9')
    expect(readouts.at(-1)).toBe('Today · Google shows 4.0')
    expect(
      readouts.every((readout) =>
        /^(?:[A-Z][a-z]{2} \d+ · Google showed|Today · Google shows) \d\.\d$/u.test(
          readout,
        ),
      ),
    ).toBe(true)
  })

  it('has one readout for each point of the line, with the number Google showed that day', () => {
    const drawn = model(DETAIL_HARBORLINE)

    expect(drawn.stops).toHaveLength(CHART.history!.length)
    // Google moved to 4.0 on day -6, so the Monday of day -9 reads 3.9 and day -2 reads 4.0.
    expect(drawn.stops.find((stop) => stop.key === -9)?.line).toBe(
      'Oct 5 · Google showed 3.9',
    )
    expect(drawn.stops.find((stop) => stop.key === -2)?.line).toBe(
      'Oct 12 · Google showed 4.0',
    )
  })

  it('gives every readout its own key', () => {
    const keys = model(DETAIL_HARBORLINE).stops.map((stop) => stop.key)

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('chooses a point only along the part of the chart that has been lived', () => {
    const drawn = model(DETAIL_HARBORLINE)

    expect(drawn.pastWidth).toBe(drawn.today.x)
    expect(drawn.stops.at(-1)?.x).toBe(drawn.today.x)
  })
})

describe('the sentence for a screen reader', () => {
  it('says what Google showed, what it shows today and when the goal arrives', () => {
    expect(model(DETAIL_HARBORLINE).sentence).toBe(
      'Google showed 3.9 when you set the goal and shows 4.0 today. 4.1 in about 3 weeks.',
    )
  })

  it('leaves the arrival out when there is none to give', () => {
    expect(model(DETAIL_LAGS).sentence).toBe(
      'Google showed 3.9 when you set the goal and shows 4.0 today.',
    )
    expect(model(DETAIL_TOO_LOW).sentence).toBe(
      'Google showed 3.9 when you set the goal and shows 4.0 today.',
    )
  })

  it('says only what Google showed when it has no number now', () => {
    const drawn = model({ ...DETAIL_HARBORLINE, google: null })

    expect(drawn.sentence).toBe(
      'Google showed 3.9 when you set the goal. 4.1 in about 3 weeks.',
    )
  })

  it('says the goal is more than three years away when it is', () => {
    expect(model({ ...DETAIL_HARBORLINE, forecast: inDays(1200) }).sentence).toBe(
      'Google showed 3.9 when you set the goal and shows 4.0 today. 4.1 is more than 3 years away.',
    )
  })

  it('says the line follows Google’s own number while RepKey lacks some of its reviews', () => {
    expect(model(DETAIL_GOOGLE_SOURCE).sentence).toBe(
      'Google showed 3.9 when you set the goal and shows 4.0 today. RepKey doesn’t hold every review yet, so this follows Google’s own number. 4.1 in about 3 weeks.',
    )
    expect(model(DETAIL_HARBORLINE).sentence).not.toContain('RepKey')
  })
})
