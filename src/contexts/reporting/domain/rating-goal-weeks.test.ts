import { describe, expect, it } from 'vitest'
import {
  chartStart,
  chartWeeks,
  dayOfInstant,
  daysFromToday,
  MAX_WEEKLY_BARS,
  propertyWeekday,
  shiftDateKey,
  weekStartInstant,
  weekStartKey,
  weeklySeries,
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

describe('the day of the Property week', () => {
  it.each([
    // Sofia leaves summer time on Sunday 25 Oct 2026 (UTC+3 → UTC+2).
    ['Sunday 23:59 before the clocks go back', '2026-10-25T21:59:00.000Z', 7],
    ['Monday 00:00 after the clocks go back', '2026-10-25T22:00:00.000Z', 1],
    // Sofia enters summer time on Sunday 29 Mar 2026 (UTC+2 → UTC+3).
    ['Sunday 23:59 after the clocks go forward', '2026-03-29T20:59:00.000Z', 7],
    ['Monday 00:00 after the clocks go forward', '2026-03-29T21:00:00.000Z', 1],
    ['a Tuesday afternoon', '2026-10-13T12:00:00.000Z', 2],
  ] as const)('counts %s from Monday as 1', (_when, instant, weekday) => {
    expect(propertyWeekday(new Date(instant), SOFIA)).toBe(weekday)
  })

  it('reads the day on the Property’s clock, not UTC’s', () => {
    // 21:30 UTC on Sunday is already Monday in Sofia.
    const instant = new Date('2026-10-18T21:30:00.000Z')

    expect(propertyWeekday(instant, SOFIA)).toBe(1)
    expect(propertyWeekday(instant, 'UTC')).toBe(7)
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
  })
})

describe('the days of the detail chart', () => {
  // Tuesday 27 October 2026, after Sofia left summer time on Sunday 25 October.
  const now = new Date('2026-10-27T10:00:00.000Z')

  it('counts whole Property-local days from today, across the clocks going back', () => {
    expect(daysFromToday('2026-10-27', now, SOFIA)).toBe(0)
    expect(daysFromToday('2026-10-19', now, SOFIA)).toBe(-8)
    expect(daysFromToday('2026-11-02', now, SOFIA)).toBe(6)
  })

  it('puts an instant on its Property-local date', () => {
    // 21:30 UTC on Sunday 25 Oct is 23:30 that Sunday in Sofia (UTC+2).
    expect(dayOfInstant(new Date('2026-10-25T21:30:00.000Z'), now, SOFIA)).toBe(-2)
    // 22:30 UTC on Sunday 25 Oct is 00:30 on Monday 26 Oct.
    expect(dayOfInstant(new Date('2026-10-25T22:30:00.000Z'), now, SOFIA)).toBe(-1)
  })

  it('moves a date by whole days', () => {
    expect(shiftDateKey('2026-10-12', -28)).toBe('2026-09-14')
    expect(shiftDateKey('2026-12-28', 7)).toBe('2027-01-04')
  })

  it('starts four weeks before the Monday of the set’s week', () => {
    // Set on Wednesday 14 Oct: that week's Monday is 12 Oct, minus 28 days.
    expect(chartStart(new Date('2026-10-14T09:00:00.000Z'), now, SOFIA)).toEqual({
      key: '2026-09-14',
      instant: new Date('2026-09-13T21:00:00.000Z'),
    })
  })

  it('starts a year back at most', () => {
    // This Monday is 26 Oct; 52 weeks before it, Sofia is on winter time.
    expect(chartStart(new Date('2025-06-01T09:00:00.000Z'), now, SOFIA)).toEqual({
      key: '2025-10-27',
      instant: new Date('2025-10-26T22:00:00.000Z'),
    })
  })

  it('lists every Monday from the start to this week’s', () => {
    expect(chartWeeks('2026-09-28', now, SOFIA)).toEqual([
      '2026-09-28',
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
    ])
  })
})
