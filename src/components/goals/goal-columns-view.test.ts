// A goal's bars, worked out (2026-11-01): one scale from none to a little above the
// highest figure, number or plan, so a plan's line and a month's mark always have room
// above the bars; a bar that cannot be read draws nothing; a figure sits over a mark
// that is close above its bar.
import { describe, expect, it } from 'vitest'
import { columnsModel, type GoalColumn } from './goal-columns-view'

/** A column with nothing but a value; a test adds only what it is about. */
const column = (key: string, value: number | null, extra: Partial<GoalColumn> = {}) => ({
  key,
  label: key,
  value,
  figure: value === null ? null : String(value),
  tone: 'since' as const,
  mark: null,
  met: false,
  line: `${key}: ${value}`,
  ...extra,
})

/** The plot's headroom: the tallest thing is drawn this high, not to the top. */
const TALLEST = 100 / 1.12

describe('the scale of the bars', () => {
  it('draws the tallest bar a little under the top of the plot', () => {
    const { columns } = columnsModel([column('a', 4), column('b', 10), column('c', 7)])

    expect(columns.map((one) => one.height)).toEqual([
      expect.closeTo(TALLEST * 0.4, 5),
      expect.closeTo(TALLEST, 5),
      expect.closeTo(TALLEST * 0.7, 5),
    ])
  })

  it('reaches up to the plan when the plan is higher than every bar', () => {
    const { columns, plan } = columnsModel([column('a', 2), column('b', 5)], {
      value: 10,
      from: 0,
      words: 'Your plan: 10 a week',
    })

    expect(plan?.height).toBeCloseTo(TALLEST, 5)
    expect(columns[1]?.height).toBeCloseTo(TALLEST * 0.5, 5)
  })

  it('reaches up to the tallest bar when the plan is lower than it', () => {
    const { columns, plan } = columnsModel([column('a', 12), column('b', 5)], {
      value: 6,
      from: 0,
      words: 'Your plan: 6 a week',
    })

    expect(columns[0]?.height).toBeCloseTo(TALLEST, 5)
    expect(plan?.height).toBeCloseTo(TALLEST * 0.5, 5)
  })

  it('reaches up to a month’s mark when the mark is higher than every bar and the plan', () => {
    const { columns } = columnsModel([
      column('a', 3, { mark: 8 }),
      column('b', 5, { mark: 4 }),
    ])

    expect(columns[0]?.tickHeight).toBeCloseTo(TALLEST, 5)
    expect(columns[0]?.height).toBeCloseTo(TALLEST * (3 / 8), 5)
    expect(columns[1]?.tickHeight).toBeCloseTo(TALLEST * 0.5, 5)
  })

  it('keeps a scale of at least one, so bars of none or one do not fill the plot', () => {
    const { columns } = columnsModel([column('a', 0), column('b', 1)])

    expect(columns[0]?.height).toBe(0)
    expect(columns[1]?.height).toBeCloseTo(TALLEST, 5)
    expect(columnsModel([column('a', 0)]).columns[0]?.height).toBe(0)
  })
})

describe('a bar that cannot be read', () => {
  it('draws a height of none for a value that is null, never a bar', () => {
    const { columns } = columnsModel([column('open', null), column('known', 6)])

    expect(columns[0]).toMatchObject({ value: null, height: 0, tall: false })
    expect(columns[1]?.height).toBeGreaterThan(0)
  })

  it('does not let its missing value set the scale', () => {
    const { columns } = columnsModel([column('open', null), column('known', 5)])

    expect(columns[1]?.height).toBeCloseTo(TALLEST, 5)
  })

  it('still marks the month’s own number across it', () => {
    const [unread] = columnsModel([column('open', null, { mark: 10 })]).columns

    expect(unread?.height).toBe(0)
    expect(unread?.tickHeight).toBeCloseTo(TALLEST, 5)
    expect(unread?.tickGap).toBeCloseTo(TALLEST, 5)
  })
})

describe('a tall bar', () => {
  it('is tall from 22 of 100 up, where its figure fits at its foot', () => {
    // With a peak of 10, a bar of 3 stands at 26.8 and a bar of 2 at 17.9.
    const { columns } = columnsModel([column('big', 10), column('3', 3), column('2', 2)])

    expect(columns.map((one) => one.tall)).toEqual([true, true, false])
  })
})

describe('a figure over a close mark', () => {
  it('goes over the mark when the mark stands just above the bar', () => {
    // Peak 11: a scale of 8.1 a unit, so the mark is one unit (8.1) above the bar.
    const { columns } = columnsModel([column('a', 10, { mark: 11 })])

    expect(columns[0]?.figureAboveTick).toBe(true)
    expect(columns[0]?.tickGap).toBeCloseTo(TALLEST / 11, 5)
  })

  it('sits right on the bar when the mark is far above it', () => {
    const { columns } = columnsModel([column('a', 2, { mark: 11 })])

    expect(columns[0]?.figureAboveTick).toBe(false)
    expect(columns[0]?.tickGap).toBeGreaterThan(16)
  })

  it('sits on the bar when the bar reaches past its mark, which needs no gap', () => {
    const { columns } = columnsModel([column('a', 12, { mark: 10 })])

    expect(columns[0]?.figureAboveTick).toBe(false)
    expect(columns[0]?.tickGap).toBe(0)
  })

  it('goes over the mark when the bar meets it exactly', () => {
    const { columns } = columnsModel([column('a', 10, { mark: 10 })])

    expect(columns[0]?.figureAboveTick).toBe(true)
    expect(columns[0]?.tickGap).toBe(0)
  })

  it('has no mark to go over for a bar that carries none', () => {
    const { columns } = columnsModel([column('a', 5), column('b', 8)])

    expect(columns.map((one) => one.tickHeight)).toEqual([null, null])
    expect(columns.map((one) => one.tickGap)).toEqual([0, 0])
    expect(columns.map((one) => one.figureAboveTick)).toEqual([false, false])
  })
})

describe('the plan’s line', () => {
  const plan = (from: number) => ({ value: 7, from, words: 'Your plan: 7 a week' })

  it('starts at the share of the plot where its first column begins', () => {
    const bars = Array.from({ length: 12 }, (_, index) => column(`w${index}`, index))

    expect(columnsModel(bars, plan(0)).plan?.left).toBe(0)
    expect(columnsModel(bars, plan(3)).plan?.left).toBe(25)
    expect(columnsModel(bars, plan(6)).plan?.left).toBe(50)
  })

  it('runs under the last column when it starts from the end', () => {
    const bars = [column('a', 1), column('b', 2), column('c', 3), column('d', 4)]

    expect(columnsModel(bars, plan(4)).plan?.left).toBe(100)
  })

  it('stands as high as its number on the same scale as the bars', () => {
    const { columns, plan: line } = columnsModel(
      [column('a', 14), column('b', 7)],
      plan(0),
    )

    expect(line?.height).toBeCloseTo(columns[1]?.height ?? 0, 5)
  })

  it('is not drawn without a plan, or without a column to draw it across', () => {
    expect(columnsModel([column('a', 3)]).plan).toBeNull()
    expect(columnsModel([], plan(0)).plan).toBeNull()
  })
})

describe('what a column keeps of its own', () => {
  it('hands on its words, its tone and whether it was met', () => {
    const { columns } = columnsModel([
      column('nov', 41, {
        label: 'Nov',
        figure: '41',
        tone: 'open',
        met: true,
        line: 'November: 41 of 40. Met.',
      }),
    ])

    expect(columns[0]).toMatchObject({
      key: 'nov',
      label: 'Nov',
      figure: '41',
      tone: 'open',
      met: true,
      line: 'November: 41 of 40. Met.',
    })
  })

  it('draws no column at all for no columns', () => {
    expect(columnsModel([]).columns).toEqual([])
  })
})
