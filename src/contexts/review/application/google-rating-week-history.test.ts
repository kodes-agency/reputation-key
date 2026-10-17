import { describe, expect, it } from 'vitest'
import { endOfWeekAverages } from './google-rating-week-history'

describe('endOfWeekAverages', () => {
  it('works each week end back from every review there is, the last week ending today', () => {
    // Arrange: 300 reviews summing 1,200; the last two weeks hold 10 (46) and 5 (25).
    const all = { count: 300, sum: 1200 }
    const weeks = [
      { weekStart: '2026-10-05', count: 10, sum: 46 },
      { weekStart: '2026-10-12', count: 5, sum: 25 },
    ]

    // Act
    const history = endOfWeekAverages(all, weeks)

    // Assert: 1200/300 = 4.000; 1175/295 = 3.983; 1129/285 = 3.961.
    expect(history).toEqual({
      startAverageThousandths: 3961,
      weeks: [
        { weekStart: '2026-10-05', count: 10, endAverageThousandths: 3983 },
        { weekStart: '2026-10-12', count: 5, endAverageThousandths: 4000 },
      ],
    })
  })

  it('carries no week sum out, only counts and averages', () => {
    const history = endOfWeekAverages({ count: 12, sum: 50 }, [
      { weekStart: '2026-10-12', count: 2, sum: 9 },
    ])

    expect(Object.keys(history.weeks[0] ?? {}).sort()).toEqual([
      'count',
      'endAverageThousandths',
      'weekStart',
    ])
  })

  it('rounds an average half up to thousandths', () => {
    // 4.0625 → 4.063 (half up), 9/8 → 1.125.
    const history = endOfWeekAverages({ count: 16, sum: 65 }, [
      { weekStart: '2026-10-12', count: 8, sum: 56 },
    ])

    expect(history.weeks[0]?.endAverageThousandths).toBe(4063)
    expect(history.startAverageThousandths).toBe(1125)
  })

  it('has no start average when every review came in the weeks since', () => {
    const history = endOfWeekAverages({ count: 3, sum: 13 }, [
      { weekStart: '2026-10-05', count: 1, sum: 5 },
      { weekStart: '2026-10-12', count: 2, sum: 8 },
    ])

    expect(history.startAverageThousandths).toBeNull()
    expect(history.weeks.map((week) => week.endAverageThousandths)).toEqual([5000, 4333])
  })

  it('has only a start when no review came since', () => {
    expect(endOfWeekAverages({ count: 4, sum: 18 }, [])).toEqual({
      startAverageThousandths: 4500,
      weeks: [],
    })
  })

  it('orders weeks oldest first whatever order they arrive in', () => {
    const history = endOfWeekAverages({ count: 20, sum: 80 }, [
      { weekStart: '2026-10-12', count: 2, sum: 10 },
      { weekStart: '2026-09-28', count: 2, sum: 2 },
    ])

    expect(history.weeks.map((week) => week.weekStart)).toEqual([
      '2026-09-28',
      '2026-10-12',
    ])
    // Before 12 Oct: 70 / 18; before 28 Sep: 68 / 16.
    expect(history.weeks.map((week) => week.endAverageThousandths)).toEqual([3889, 4000])
    expect(history.startAverageThousandths).toBe(4250)
  })
})
