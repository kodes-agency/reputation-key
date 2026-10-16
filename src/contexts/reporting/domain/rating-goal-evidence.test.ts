import { describe, expect, it } from 'vitest'
import { ratio } from './rating-goal-numbers'
import {
  DAY_READ_LOOKBACK_DAYS,
  EVIDENCE_MIN_REVIEWS,
  MONTH_READ_LOOKBACK_DAYS,
  bestMonth,
  busiestWindowCount,
  type DayCount,
  type MonthTotals,
} from './rating-goal-evidence'

const SOFIA = 'Europe/Sofia'
/** Friday 16 October 2026, 15:00 in Sofia. */
const NOW = new Date('2026-10-16T12:00:00.000Z')

const month = (year: number, m: number, count: number, sum: number): MonthTotals => ({
  year,
  month: m,
  count,
  sum,
})

/** `count` reviews on each of `days` consecutive dates from `first` (YYYY-MM-DD). */
function run(first: string, days: number, count: number): DayCount[] {
  const start = Date.parse(`${first}T00:00:00Z`)
  return Array.from({ length: days }, (_, index) => ({
    day: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    count,
  }))
}

describe('the reads the evidence is worked out from', () => {
  it('ask for months with ten reviews, over generous UTC bounds the domain trims', () => {
    expect(EVIDENCE_MIN_REVIEWS).toBe(10)
    expect(MONTH_READ_LOOKBACK_DAYS).toBe(400)
    expect(DAY_READ_LOOKBACK_DAYS).toBe(366)
  })
})

describe('the best calendar month', () => {
  it('takes the highest average of the last twelve months, the current part month included', () => {
    const best = bestMonth(
      [
        month(2025, 10, 30, 150), // twelve months back: out, even at 5.0
        month(2025, 11, 20, 90), // 4.5, eleven months back: in
        month(2026, 8, 11, 52), // 4.727
        month(2026, 10, 10, 48), // 4.8, this month so far
      ],
      NOW,
      SOFIA,
    )

    expect(best).toEqual({
      year: 2026,
      month: 10,
      average: ratio(48, 10),
      reviewCount: 10,
    })
  })

  it('keeps the month eleven months back and leaves out the one before', () => {
    expect(bestMonth([month(2025, 11, 10, 45)], NOW, SOFIA)).toMatchObject({
      year: 2025,
      month: 11,
    })
    expect(bestMonth([month(2025, 10, 10, 50)], NOW, SOFIA)).toBeNull()
  })

  it('ignores a month with fewer than ten reviews', () => {
    expect(
      bestMonth([month(2026, 9, 9, 45), month(2026, 8, 10, 40)], NOW, SOFIA),
    ).toEqual({ year: 2026, month: 8, average: ratio(40, 10), reviewCount: 10 })
    expect(bestMonth([month(2026, 9, 9, 45)], NOW, SOFIA)).toBeNull()
    expect(bestMonth([], NOW, SOFIA)).toBeNull()
  })

  it('takes the later month on a tie', () => {
    expect(
      bestMonth([month(2026, 5, 10, 45), month(2026, 7, 20, 90)], NOW, SOFIA),
    ).toMatchObject({ month: 7, reviewCount: 20 })
  })

  it('counts the months of the Property’s calendar across a new year', () => {
    // 22:30 UTC on 31 Dec 2026 is 00:30 on 1 Jan 2027 in Sofia.
    const newYear = new Date('2026-12-31T22:30:00.000Z')

    expect(
      bestMonth([month(2026, 1, 10, 50), month(2027, 1, 10, 41)], newYear, SOFIA),
    ).toMatchObject({ year: 2027, month: 1 })
    expect(bestMonth([month(2026, 2, 10, 46)], newYear, SOFIA)).toMatchObject({
      year: 2026,
      month: 2,
    })
  })
})

describe('the busiest 30 days', () => {
  it('sums 30 consecutive Property-local dates, a date without reviews counting zero', () => {
    const days = [
      { day: '2026-08-01', count: 5 },
      { day: '2026-08-20', count: 7 },
      // 30 dates from 1 Aug end on 30 Aug: 31 Aug falls in the next window.
      { day: '2026-08-31', count: 4 },
      { day: '2026-09-25', count: 2 },
    ]

    // 1 to 30 Aug holds 12; 2 to 31 Aug holds 11.
    expect(busiestWindowCount(days, NOW, SOFIA)).toBe(12)
  })

  it('counts across the change to summer time by date, not by 24 hours', () => {
    // Sofia moves to UTC+3 on 29 Mar 2026: 30 dates from 15 Mar end on 13 Apr.
    const days = [...run('2026-03-15', 30, 1), { day: '2026-04-14', count: 1 }]

    expect(busiestWindowCount(days, NOW, SOFIA)).toBe(30)
  })

  it('looks back 365 Property-local dates, today included', () => {
    // Today in Sofia is 16 Oct 2026; 365 dates back starts on 17 Oct 2025.
    expect(busiestWindowCount([{ day: '2025-10-17', count: 9 }], NOW, SOFIA)).toBe(9)
    expect(busiestWindowCount([{ day: '2025-10-16', count: 9 }], NOW, SOFIA)).toBe(0)
    expect(busiestWindowCount([{ day: '2026-10-16', count: 3 }], NOW, SOFIA)).toBe(3)
  })

  it('takes what there is with fewer than 30 days of history, and nothing without', () => {
    expect(busiestWindowCount(run('2026-10-05', 12, 2), NOW, SOFIA)).toBe(24)
    expect(busiestWindowCount([], NOW, SOFIA)).toBe(0)
  })
})
