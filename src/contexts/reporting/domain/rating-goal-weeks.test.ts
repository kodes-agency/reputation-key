import { describe, expect, it } from 'vitest'
import {
  MAX_WEEKLY_BARS,
  weekStartInstant,
  weekStartKey,
  weeklySeries,
  weeklySeriesStart,
} from './rating-goal-weeks'

const SOFIA = 'Europe/Sofia'

describe('Monday-to-Sunday weeks in the Property time zone', () => {
  it('puts a Sunday-night UTC instant in the Sofia week that starts that Monday', () => {
    // 21:30 UTC on Sunday 18 Oct is 00:30 on Monday 19 Oct in Sofia (UTC+3).
    const instant = new Date('2026-10-18T21:30:00.000Z')

    expect(weekStartKey(instant, SOFIA)).toBe('2026-10-19')
    expect(weekStartKey(instant, 'UTC')).toBe('2026-10-12')
  })

  it('starts the week at local midnight on Monday', () => {
    expect(weekStartInstant(new Date('2026-10-14T12:00:00.000Z'), SOFIA)).toEqual(
      new Date('2026-10-11T21:00:00.000Z'),
    )
  })

  it('starts the week after the clocks go back at the new offset', () => {
    // Sofia leaves summer time on 25 Oct: Monday 26 Oct starts at 22:00 UTC.
    expect(weekStartInstant(new Date('2026-10-27T12:00:00.000Z'), SOFIA)).toEqual(
      new Date('2026-10-25T22:00:00.000Z'),
    )
  })
})

describe('the weekly bars since a goal was set', () => {
  it('fills every week from the one the goal was set in to this one', () => {
    expect(
      weeklySeries(
        new Date('2026-10-14T12:00:00.000Z'),
        new Date('2026-10-27T12:00:00.000Z'),
        SOFIA,
        [{ weekStart: '2026-10-19', count: 5 }],
      ),
    ).toEqual([
      { weekStart: '2026-10-12', count: 0 },
      { weekStart: '2026-10-19', count: 5 },
      { weekStart: '2026-10-26', count: 0 },
    ])
  })

  it('shows at most a year of weeks', () => {
    const now = new Date('2026-10-14T12:00:00.000Z')
    const twoYearsAgo = new Date('2024-10-14T12:00:00.000Z')

    expect(MAX_WEEKLY_BARS).toBe(52)
    expect(weeklySeries(twoYearsAgo, now, 'UTC', [])).toHaveLength(52)
    expect(weeklySeriesStart(twoYearsAgo, now, 'UTC')).toEqual(
      new Date('2025-10-20T00:00:00.000Z'),
    )
  })
})
