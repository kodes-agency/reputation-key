// The line to the goal's arithmetic (2026-11-01): the days along the bottom and the
// stars up the side as shares of the plot, the paths, and the months under them. The
// points it is drawn through are in `rating-goal-line-chart-points.test.ts`.
import { describe, expect, it } from 'vitest'
import {
  dayText,
  monthsOf,
  pathOf,
  scaleOf,
  shiftKey,
  type Scale,
} from './rating-goal-line-chart-scale'
import { DETAIL_HARBORLINE } from './rating-goal-detail.stories.fixtures'

const CHART = DETAIL_HARBORLINE.chart!

/** A scale that leaves days and thousandths as they are, so a path reads as its points. */
const IDENTITY: Scale = { x: (day) => day, y: (value) => value, end: 0, first: 0 }

describe('moving a date', () => {
  it('moves a date by whole days, back or ahead', () => {
    expect(shiftKey('2026-10-14', 0)).toBe('2026-10-14')
    expect(shiftKey('2026-10-14', -6)).toBe('2026-10-08')
    expect(shiftKey('2026-10-14', 18)).toBe('2026-11-01')
  })

  it('crosses the end of a month and of a year', () => {
    expect(shiftKey('2026-12-30', 3)).toBe('2027-01-02')
    expect(shiftKey('2027-03-01', -1)).toBe('2027-02-28')
  })

  it('knows a leap day', () => {
    expect(shiftKey('2028-02-28', 1)).toBe('2028-02-29')
    expect(shiftKey('2028-02-29', 1)).toBe('2028-03-01')
  })
})

describe('naming a day', () => {
  it('names a day from today as a short date without its year', () => {
    expect(dayText('2026-10-14', 0)).toBe('Oct 14')
    expect(dayText('2026-10-14', -6)).toBe('Oct 8')
    expect(dayText('2026-10-14', 18)).toBe('Nov 1')
  })
})

describe('the plot’s scale', () => {
  const POINTS = [
    { day: -100, thousandths: 3900 },
    { day: 0, thousandths: 4000 },
  ]
  const chart = { ...CHART, firstDay: -100 }
  const scale = (arrival: number | null, points = POINTS) =>
    scaleOf(points, chart, 4100, arrival, 3850)

  it('runs from the first point to a little past today when there is no arrival', () => {
    const plot = scale(null)

    // A century of past gives four days of room (4%), so 104 days across.
    expect(plot.first).toBe(-100)
    expect(plot.end).toBe(4)
    expect(plot.x(-100)).toBe(0)
    expect(plot.x(0)).toBe(96.15)
    expect(plot.x(4)).toBe(100)
  })

  it('gives the end at least three days of room', () => {
    const short = scale(null, [
      { day: -20, thousandths: 3900 },
      { day: 0, thousandths: 4000 },
    ])

    // 4% of twenty days of past is under a day.
    expect(short.end).toBe(3)
  })

  it('treats a very short history as two weeks long, so a near arrival still fits whole', () => {
    const short = scale(13, [
      { day: -5, thousandths: 3900 },
      { day: 0, thousandths: 4000 },
    ])

    // 13 days and 3 of room are under 1.2 of fourteen days, not of five.
    expect(short.first).toBe(-5)
    expect(short.end).toBe(16)
  })

  it('runs to the arrival and a little past it when the whole way fits', () => {
    const plot = scale(30)

    expect(plot.end).toBe(34)
    expect(plot.x(0)).toBe(74.63)
    expect(plot.x(30)).toBe(97.01)
  })

  it('still fits the whole way when it is up to 1.2 times the past', () => {
    expect(scale(116).end).toBe(120)
  })

  it('cuts the way off at 0.42 of the past when it is any longer', () => {
    expect(scale(117).end).toBe(42)
    expect(scale(330).end).toBe(42)
  })

  it('cuts an arrival of 330 days off at 0.42 of a past of 56 days', () => {
    const fiftySix = scaleOf(
      [
        { day: -56, thousandths: 3900 },
        { day: 0, thousandths: 4000 },
      ],
      { ...CHART, firstDay: -56 },
      4100,
      330,
      3850,
    )

    expect(fiftySix.end).toBeCloseTo(23.52, 6)
    expect(fiftySix.x(0)).toBe(70.42)
  })

  it('puts the goal’s line a little under the top and the lowest line a little over the floor', () => {
    const plot = scale(null)

    // 14% of the 250 between them above the goal, 7% below the lowest line.
    expect(plot.y(4100)).toBe(11.57)
    expect(plot.y(3850)).toBe(94.21)
    expect(plot.y(3900)).toBe(77.69)
    expect(plot.y(4000)).toBe(44.63)
  })

  it('makes room for a point above the goal’s line', () => {
    const above = scaleOf(
      [
        { day: -100, thousandths: 3900 },
        { day: 0, thousandths: 4172 },
      ],
      chart,
      4100,
      null,
      3850,
    )

    expect(above.y(4172)).toBeLessThan(above.y(4100))
    expect(above.y(4172)).toBeGreaterThan(0)
  })

  it('makes room for a point below the lowest line', () => {
    const below = scaleOf(
      [
        { day: -100, thousandths: 3790 },
        { day: 0, thousandths: 4000 },
      ],
      chart,
      4100,
      null,
      3850,
    )

    expect(below.y(3790)).toBeGreaterThan(below.y(3850))
    expect(below.y(3790)).toBeLessThan(100)
  })

  it('stays finite when every value is the same', () => {
    const flat = scaleOf(
      [
        { day: -20, thousandths: 4000 },
        { day: 0, thousandths: 4000 },
      ],
      chart,
      4000,
      null,
      4000,
    )

    expect(Number.isFinite(flat.y(4000))).toBe(true)
    expect(flat.y(4000)).toBeGreaterThan(0)
    expect(flat.y(4000)).toBeLessThan(100)
  })

  it('starts at the chart’s first day when there is no point', () => {
    const empty = scaleOf([], chart, 4100, null, 3850)

    expect(empty.first).toBe(-100)
  })
})

describe('a path', () => {
  it('moves to the first point and runs through the others in order', () => {
    expect(
      pathOf(
        [
          { day: 0, thousandths: 100 },
          { day: 5, thousandths: 200 },
          { day: 9, thousandths: 150 },
        ],
        IDENTITY,
      ),
    ).toBe('M0 100L5 200L9 150')
  })

  it('is a move alone for a single point, and nothing for none', () => {
    expect(pathOf([{ day: 3, thousandths: 40 }], IDENTITY)).toBe('M3 40')
    expect(pathOf([], IDENTITY)).toBe('')
  })

  it('places each point by the scale it is given', () => {
    const halved: Scale = {
      x: (day) => day / 2,
      y: (value) => value / 10,
      end: 0,
      first: 0,
    }

    expect(
      pathOf(
        [
          { day: 10, thousandths: 300 },
          { day: 20, thousandths: 400 },
        ],
        halved,
      ),
    ).toBe('M5 30L10 40')
  })
})

describe('the months under the line', () => {
  /** The days a chart from `first` to `end` names its months at, on a scale that keeps days. */
  const months = (first: number, end: number) =>
    monthsOf('2026-10-14', { ...IDENTITY, first, end })

  it('names the first of each month inside the chart, where it falls', () => {
    // 24 Aug to 4 Nov: 1 Sep, 1 Oct and 1 Nov.
    expect(months(-51, 21)).toEqual([
      { x: -43, label: 'Sep' },
      { x: -13, label: 'Oct' },
      { x: 18, label: 'Nov' },
    ])
  })

  it('leaves out the month the chart starts in, whose first day is behind it', () => {
    expect(months(-51, 21).map((month) => month.label)).not.toContain('Aug')
  })

  it('names a month whose first day is the chart’s last, and not one that is a day later', () => {
    expect(months(-51, 18).map((month) => month.label)).toContain('Nov')
    expect(months(-51, 17).map((month) => month.label)).not.toContain('Nov')
  })

  it('names no month when none begins inside the chart', () => {
    // 15 Oct to 28 Oct has no first of a month in it.
    expect(months(1, 14)).toEqual([])
  })

  it('names every month while there are eight or fewer', () => {
    // 10 Feb to 20 Oct: March to October.
    expect(months(-246, 6).map((month) => month.label)).toEqual([
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
    ])
  })

  it('names every other month, from the first, once there are more than eight', () => {
    // 17 Jan to 20 Oct: February to October, nine of them.
    expect(months(-270, 6).map((month) => month.label)).toEqual([
      'Feb',
      'Apr',
      'Jun',
      'Aug',
      'Oct',
    ])
  })

  it('names every other month of a year, across the turn of the year', () => {
    // 13 Oct 2025 to 13 Nov 2026: November to November, thirteen months.
    expect(months(-366, 30).map((month) => month.label)).toEqual([
      'Nov',
      'Jan',
      'Mar',
      'May',
      'Jul',
      'Sep',
      'Nov',
    ])
  })

  it('places each month on the scale it is given', () => {
    const [first] = monthsOf('2026-10-14', {
      x: (day) => day + 100,
      y: (value) => value,
      first: -51,
      end: 21,
    })

    expect(first).toEqual({ x: 57, label: 'Sep' })
  })
})
