// The new reviews of each week against the plan (2026-11-01, ADR 0067): 13 weeks at most,
// this one last and dashed, the weeks before the goal in a quieter ink with no figure,
// and the plan's line starting at the first week of the goal.
import { describe, expect, it } from 'vitest'
import { weekBars } from './rating-goal-review-facts-view'
import { DETAIL_HARBORLINE, DETAIL_OLD_GOAL } from './rating-goal-detail.stories.fixtures'
import {
  DETAIL_JUST_SET,
  DETAIL_KEEP,
} from './rating-goal-detail-states.stories.fixtures'

type Detail = Parameters<typeof weekBars>[0]
type Chart = NonNullable<Detail['chart']>

/** The Monday itself, so a column's label is the date it stands for. */
const isoDay = (key: string): string => key

const bars = (detail: Detail, dayWords: (key: string) => string = isoDay) => {
  const drawn = weekBars(detail, dayWords)
  if (drawn === null) throw new Error('expected bars')
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

/** `count` weeks ending with this one (Monday -2), each with the reviews `reviews` says. */
const weeks = (count: number, reviews: (index: number) => number = () => 3) =>
  Array.from({ length: count }, (_, index) => ({
    day: -2 - 7 * (count - 1 - index),
    count: reviews(index),
  }))

describe('a column for each week', () => {
  it('draws the weeks oldest first, this one last, each named by its Monday', () => {
    const drawn = bars(DETAIL_HARBORLINE)

    expect(drawn.columns.map((column) => column.key)).toEqual([
      '-51',
      '-44',
      '-37',
      '-30',
      '-23',
      '-16',
      '-9',
      '-2',
    ])
    expect(drawn.columns[0]?.label).toBe('2026-08-24')
    expect(drawn.columns.at(-1)?.label).toBe('2026-10-12')
  })

  it('names a week with the words it is given for its Monday', () => {
    const drawn = bars(DETAIL_HARBORLINE, (key) => `Monday ${key.slice(5)}`)

    expect(drawn.columns.at(-1)?.label).toBe('Monday 10-12')
    expect(drawn.columns.at(-1)?.line).toBe('Week of Monday 10-12 · 2 new reviews so far')
  })

  it('draws a bar as high as the week’s new reviews', () => {
    const drawn = bars(DETAIL_HARBORLINE)

    expect(drawn.columns.map((column) => column.value)).toEqual([0, 1, 0, 1, 6, 9, 10, 2])
  })

  it('reads each week out, one review in the singular', () => {
    const drawn = bars(DETAIL_HARBORLINE)

    expect(drawn.columns[1]?.line).toBe('Week of 2026-08-31 · 1 new review')
    expect(drawn.columns[4]?.line).toBe('Week of 2026-09-21 · 6 new reviews')
  })

  it('carries no mark of its own and is never met: a week is counted against one line', () => {
    const drawn = bars(DETAIL_HARBORLINE)

    expect(drawn.columns.every((column) => column.mark === null && !column.met)).toBe(
      true,
    )
  })
})

describe('13 weeks at most', () => {
  it('draws every week while there are 13 or fewer', () => {
    expect(bars(DETAIL_HARBORLINE).columns).toHaveLength(8)
    expect(bars(withChart({ weeks: weeks(13) })).columns).toHaveLength(13)
  })

  it('draws the newest 13 of more, this week last', () => {
    const drawn = bars(DETAIL_OLD_GOAL)

    expect(drawn.columns).toHaveLength(13)
    expect(drawn.columns[0]?.key).toBe('-86')
    expect(drawn.columns.at(-1)?.key).toBe('-2')
  })

  it('draws 13 of 14 weeks, dropping the oldest', () => {
    const drawn = bars(withChart({ weeks: weeks(14) }))

    expect(drawn.columns).toHaveLength(13)
    expect(drawn.columns[0]?.key).toBe('-86')
  })
})

describe('this week', () => {
  it('is dashed as open, with the reviews so far', () => {
    const open = bars(DETAIL_HARBORLINE).columns.at(-1)

    expect(open).toMatchObject({
      tone: 'open',
      figure: '2',
      line: 'Week of 2026-10-12 · 2 new reviews so far',
    })
  })

  it('is open on any day of it: its Monday is up to six days back', () => {
    // On a Sunday this week began on day -6, and the week before on day -13.
    const sunday = bars(
      withChart({ weeks: weeks(3).map((week) => ({ ...week, day: week.day - 4 })) }),
    )

    expect(sunday.columns.map((column) => [column.key, column.tone])).toEqual([
      ['-20', 'since'],
      ['-13', 'since'],
      ['-6', 'open'],
    ])
  })

  it('is never the week before, whose Monday is seven days back', () => {
    const drawn = bars(
      withChart({
        weeks: [
          { day: -7, count: 4 },
          { day: 0, count: 1 },
        ],
      }),
    )

    expect(drawn.columns.map((column) => column.tone)).toEqual(['since', 'open'])
  })

  it('prints its figure even when none has come yet, while a closed week with none prints none', () => {
    const drawn = bars(DETAIL_JUST_SET)

    expect(drawn.columns.at(-1)).toMatchObject({ value: 0, figure: '0', tone: 'open' })
  })
})

describe('the weeks before the goal', () => {
  it('are drawn quietly, with no figure, though some brought reviews', () => {
    const drawn = bars(DETAIL_HARBORLINE)
    const quiet = drawn.columns.slice(0, 4)

    expect(quiet.map((column) => column.tone)).toEqual([
      'before',
      'before',
      'before',
      'before',
    ])
    expect(quiet.map((column) => column.figure)).toEqual([null, null, null, null])
    expect(quiet[1]?.value).toBe(1)
  })

  it('count the week the goal was set in, which has days since it', () => {
    // Set on Thursday 24 Sep (day -20): the week of Monday 21 Sep (day -23) is the first since.
    const drawn = bars(DETAIL_HARBORLINE)

    expect(drawn.columns[4]).toMatchObject({ key: '-23', tone: 'since', figure: '6' })
  })

  it('end with the week that closed the day before the goal was set', () => {
    // Set on Monday 12 Oct: the week of 5 Oct ended on Sunday, before the set.
    const onMonday = bars(withChart({ setDay: -2 }))

    expect(onMonday.columns[6]).toMatchObject({ key: '-9', tone: 'before', figure: null })
  })

  it('do not end with a week that holds the day of the set, as Sunday does', () => {
    // Set on Sunday 11 Oct: the week of 5 Oct holds it.
    const onSunday = bars(withChart({ setDay: -3 }))

    expect(onSunday.columns[6]).toMatchObject({ key: '-9', tone: 'since', figure: '10' })
  })

  it('are all of the weeks but this one for a goal set today', () => {
    const drawn = bars(DETAIL_JUST_SET)

    expect(drawn.columns.map((column) => column.tone)).toEqual([
      'before',
      'before',
      'before',
      'before',
      'open',
    ])
  })

  it('are none of the weeks for a goal older than the weeks drawn', () => {
    expect(bars(DETAIL_OLD_GOAL).columns.map((column) => column.tone)).toEqual([
      ...Array.from({ length: 12 }, () => 'since'),
      'open',
    ])
  })
})

describe('a week since the goal', () => {
  it('prints the figure of a week that brought reviews', () => {
    expect(
      bars(DETAIL_HARBORLINE)
        .columns.slice(4, 7)
        .map((c) => c.figure),
    ).toEqual(['6', '9', '10'])
  })

  it('prints no figure for a week that brought none, though its bar is nothing', () => {
    const drawn = bars(
      withChart({
        weeks: [
          { day: -23, count: 4 },
          { day: -16, count: 0 },
          { day: -9, count: 5 },
          { day: -2, count: 1 },
        ],
      }),
    )

    expect(drawn.columns[1]).toMatchObject({ tone: 'since', value: 0, figure: null })
  })
})

describe('the plan’s line', () => {
  it('starts at the first week of the goal', () => {
    expect(bars(DETAIL_HARBORLINE).plan.from).toBe(4)
  })

  it('spans every week for a goal set this week: a line over one bar says little', () => {
    expect(bars(DETAIL_JUST_SET).plan.from).toBe(0)
  })

  it('starts at the first week drawn for a goal older than the weeks drawn', () => {
    expect(bars(DETAIL_OLD_GOAL).plan.from).toBe(0)
  })

  it('counts from the weeks drawn when 13 weeks cut some of the weeks before the goal', () => {
    // 19 weeks, the goal set on day -40: the weeks drawn are -86 to -2, six of them before it.
    const drawn = bars(withChart({ weeks: weeks(19), setDay: -40 }))

    expect(drawn.columns.map((column) => column.tone).indexOf('since')).toBe(6)
    expect(drawn.plan.from).toBe(6)
  })

  it('says the plan a week, and its number is the plan’s week', () => {
    expect(bars(DETAIL_HARBORLINE).plan).toMatchObject({
      value: 7,
      words: 'Your plan: 7 a week',
    })
    expect(bars(DETAIL_OLD_GOAL).plan).toMatchObject({
      value: 11,
      words: 'Your plan: 11 a week',
    })
  })

  it('says a plan under a day by the week, and at least one a week', () => {
    expect(bars({ ...DETAIL_HARBORLINE, paceTenthsPerWeek: 20 }).plan.words).toBe(
      'Your plan: 2 a week',
    )
    expect(bars({ ...DETAIL_HARBORLINE, paceTenthsPerWeek: 3 }).plan.words).toBe(
      'Your plan: 1 a week',
    )
  })
})

describe('no bars', () => {
  it('are drawn for a goal to keep a number, which has no chart', () => {
    expect(weekBars(DETAIL_KEEP, isoDay)).toBeNull()
  })

  it('are drawn for a goal without a plan', () => {
    expect(weekBars({ ...DETAIL_HARBORLINE, paceTenthsPerWeek: null }, isoDay)).toBeNull()
  })

  it('are drawn for a chart without a week', () => {
    expect(weekBars(withChart({ weeks: [] }), isoDay)).toBeNull()
  })
})
