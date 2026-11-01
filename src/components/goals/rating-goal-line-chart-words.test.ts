// The words beside the points of "Your rating on Google" (2026-11-01, ADR 0067): today's
// words above or under the point, the words of Google's latest move giving way to them,
// and the months under the line.
import { describe, expect, it } from 'vitest'
import { lineChartModel, type LineChartModel } from './rating-goal-line-chart-view'
import { DETAIL_HARBORLINE, DETAIL_OLD_GOAL } from './rating-goal-detail.stories.fixtures'
import {
  DETAIL_FOUND_REACHED,
  DETAIL_WENT_BACK,
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

/** Harborline's line with its last point (today) moved. */
const endingAt = (thousandths: number): Partial<Chart> => ({
  history: [...CHART.history!.slice(0, -1), { day: 0, thousandths }],
  today: thousandths,
})

describe('today’s words', () => {
  it('stand above the point while there is room under the goal’s line', () => {
    expect(model(DETAIL_HARBORLINE).today).toMatchObject({
      words: 'Today 4.0',
      above: true,
      side: 'left',
    })
  })

  it('stand above a point that is past the goal’s line', () => {
    const drawn = model(DETAIL_FOUND_REACHED)

    expect(drawn.today.y).toBeLessThan(drawn.goalY)
    expect(drawn.today).toMatchObject({ words: 'Today 4.1', above: true })
  })

  it('stand under a point just under the goal’s line, to the right of the climbing line', () => {
    // 4.04 against 4.05: a tenth of the plot, under the room the words need above.
    const drawn = model(withChart(endingAt(4040)))

    expect(drawn.goalY).toBeLessThan(drawn.today.y)
    expect(drawn.today.y - drawn.goalY).toBeLessThan(11)
    expect(drawn.today).toMatchObject({ above: false, side: 'right' })
  })

  it('stand under that point to its left near the right edge, where there is no room', () => {
    // With no arrival the chart ends a few days past today: the point is nearly at the edge.
    const drawn = model({ ...withChart(endingAt(4040)), googleShowsSoon: true })

    expect(drawn.today.x).toBeGreaterThan(75)
    expect(drawn.today).toMatchObject({ above: false, side: 'left' })
  })

  it('stand under a point on a line that has fallen, to its left', () => {
    const drawn = model(DETAIL_WENT_BACK)

    expect(drawn.today).toMatchObject({ words: 'Today 3.9', above: false, side: 'left' })
  })

  it('never say what Google shows today, or give a time, on stale numbers', () => {
    const stale = {
      ...DETAIL_HARBORLINE,
      status: 'waiting_for_google' as const,
      google: { ...DETAIL_HARBORLINE.google!, current: false },
    }
    const drawn = model(stale)

    expect(drawn.sentence).toContain('4.0 when we last read it')
    expect(drawn.sentence).not.toContain('today')
    expect(drawn.stops.at(-1)?.line).toBe('Today · Google showed 4.0')
    expect(drawn.ahead).toBeNull()
    expect(drawn.aheadWords).toBeNull()
  })

  it('say “Last” while Google’s numbers are stale', () => {
    const stale = {
      ...DETAIL_HARBORLINE,
      google: { ...DETAIL_HARBORLINE.google!, current: false },
    }

    expect(model(stale).today.words).toBe('Last 4.0')
  })

  it('say “Today” alone when Google has no number', () => {
    expect(model({ ...DETAIL_HARBORLINE, google: null }).today.words).toBe('Today')
  })

  it('stand at the end of the line, where today is', () => {
    const drawn = model(DETAIL_HARBORLINE)

    expect(drawn.today.x).toBe(drawn.stops.at(-1)?.x)
    expect(drawn.today.y).toBe(drawn.stops.at(-1)?.y)
  })
})

describe('the words of a move of Google’s own number', () => {
  it('give way to today’s words when they stand above, near the move', () => {
    const drawn = model(DETAIL_HARBORLINE)

    // The move of day -6 lies 8 across from today (70.8), well under 25.
    expect(drawn.today.above).toBe(true)
    expect(drawn.moves).toHaveLength(1)
    expect(drawn.moves[0]?.words).toBeNull()
  })

  it('are said when today’s words stand under the point', () => {
    const drawn = model(DETAIL_WENT_BACK)

    expect(drawn.today.above).toBe(false)
    expect(drawn.moves.at(-1)?.words).toEqual({
      x: drawn.moves.at(-1)!.x,
      y: drawn.moves.at(-1)!.y,
      words: 'Back to 3.9, Oct 5',
      above: true,
      side: 'left',
    })
  })

  it('are said when the move lies 25 across or more from today, to the right of an early one', () => {
    // A move on day -40 lies 55 across from today at 70.8; it stands near the left edge.
    const drawn = model(
      withChart({
        shownChanges: [{ day: -40, tenths: 40, up: true }],
      }),
    )

    expect(drawn.moves[0]?.words).toMatchObject({
      words: 'Google showed 4.0, Sep 4',
      above: true,
      side: 'right',
    })
  })

  it('go to the left of a move that is not near the left edge', () => {
    const drawn = model(
      withChart({
        shownChanges: [{ day: -19, tenths: 40, up: true }],
      }),
    )

    expect(drawn.moves[0]?.words).toMatchObject({
      words: 'Google showed 4.0, Sep 25',
      side: 'left',
    })
  })

  it('are said of the latest move only', () => {
    const drawn = model(
      withChart({
        shownChanges: [
          { day: -40, tenths: 40, up: true },
          { day: -19, tenths: 39, up: false },
        ],
      }),
    )

    expect(drawn.moves.map((move) => move.words === null)).toEqual([true, false])
    expect(drawn.moves[1]?.words?.words).toBe('Back to 3.9, Sep 25')
  })

  it('say a move up as “Google showed” and a move down as “Back to”', () => {
    const drawn = model(
      withChart(
        {
          shownChanges: [
            { day: -40, tenths: 40, up: true },
            { day: -39, tenths: 39, up: false },
          ],
        },
        DETAIL_WENT_BACK,
      ),
    )

    expect(drawn.moves.map((move) => move.up)).toEqual([true, false])
    expect(drawn.moves[1]?.words?.words).toMatch(/^Back to 3\.9, /u)
  })

  it('stand on the line at the move’s day, one dot for each move', () => {
    const drawn = model(DETAIL_WENT_BACK)

    expect(drawn.moves.map((move) => move.key)).toEqual(['-14-40', '-9-39'])
    expect(drawn.moves.map((move) => move.up)).toEqual([true, false])
  })

  it('leave the set its words while no move is named near it', () => {
    expect(model(DETAIL_HARBORLINE).set).toMatchObject({ named: true })
  })

  it('take the set’s words when a named move stands close after it', () => {
    // Back to 3.9 on Oct 5 lies 15 across from the set: it says the more useful thing.
    const drawn = model(DETAIL_WENT_BACK)

    expect(drawn.moves.at(-1)?.words).not.toBeNull()
    expect(drawn.set).toMatchObject({ named: false })
  })

  it('leave the set its words when the named move is 25 across or more from it', () => {
    // 4.04 puts today's words under the point, so the move of yesterday is named.
    const drawn = model(
      withChart({ shownChanges: [{ day: -1, tenths: 40, up: true }], ...endingAt(4040) }),
    )

    expect(drawn.today.above).toBe(false)
    expect(drawn.moves[0]?.words).not.toBeNull()
    expect(drawn.set).toMatchObject({ named: true })
  })

  it('take the set’s words when today’s stand close to them, on the same side of the line', () => {
    // 4.04 puts today's words under the point, where the set's words are.
    const drawn = model(withChart({ ...endingAt(4040), setDay: -4, shownChanges: [] }))

    expect(drawn.today.above).toBe(false)
    expect(drawn.set).toMatchObject({ above: false, named: false })
  })

  it('leave the set its words when today’s stand close to them, across the line', () => {
    const drawn = model(withChart({ setDay: -4, shownChanges: [] }))

    expect(drawn.today.above).toBe(true)
    expect(drawn.set).toMatchObject({ above: false, named: true })
  })
})

describe('a goal set today, with one point on its line', () => {
  const alone = model(
    withChart({
      history: [{ day: 0, thousandths: 3912 }],
      firstDay: 0,
      setDay: 0,
      today: 3912,
      shownChanges: [],
    }),
  )

  it('stands at the chart’s left edge, with today’s words to its right, inside the plot', () => {
    expect(alone.today).toMatchObject({ x: 0, side: 'right' })
  })

  it('still has a place to choose that point, by pointer and by keys', () => {
    expect(alone.pastWidth).toBe(20)
    expect(alone.stops).toHaveLength(1)
  })
})

describe('the months under the line', () => {
  it('names the first of each month inside the chart', () => {
    const drawn = model(DETAIL_HARBORLINE)

    expect(drawn.months.map((month) => month.label)).toEqual(['Sep', 'Oct', 'Nov'])
    expect(drawn.months.every((month) => month.x > 0 && month.x < 100)).toBe(true)
    expect(drawn.months.map((month) => month.x)).toEqual(
      [...drawn.months.map((month) => month.x)].sort((a, b) => a - b),
    )
  })

  it('names eight months at most, evenly, however long the chart', () => {
    const labels = model(DETAIL_OLD_GOAL).months.map((month) => month.label)

    expect(labels.slice(0, 4)).toEqual(['Nov', 'Feb', 'May', 'Aug'])
    expect(labels).toHaveLength(8)
  })
})
