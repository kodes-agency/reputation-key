// Shared period-range tests.

import { describe, it, expect } from 'vitest'
import { calendarPeriodRange, dayKeyInTimezone, localDayOfMonth } from './period-range'

describe('dayKeyInTimezone', () => {
  it('formats date as yyyy_MM_dd', () => {
    const key = dayKeyInTimezone(new Date('2026-06-15T14:30:00Z'), 'UTC')
    expect(key).toBe('2026_06_15')
  })

  it('shifts day forward in positive timezone', () => {
    const key = dayKeyInTimezone(new Date('2026-06-15T23:00:00Z'), 'Asia/Tokyo')
    expect(key).toBe('2026_06_16')
  })

  it('shifts day backward in negative timezone', () => {
    const key = dayKeyInTimezone(new Date('2026-06-15T02:00:00Z'), 'America/Los_Angeles')
    expect(key).toBe('2026_06_14')
  })
})

describe('localDayOfMonth', () => {
  it('reads the day of the month on the local calendar, not the UTC one', () => {
    const lateEvening = new Date('2026-10-20T22:30:00.000Z')
    expect(localDayOfMonth(lateEvening, 'UTC')).toBe(20)
    expect(localDayOfMonth(lateEvening, 'Europe/Sofia')).toBe(21)
    expect(
      localDayOfMonth(new Date('2026-11-01T02:00:00.000Z'), 'America/New_York'),
    ).toBe(31)
  })
})

describe('calendarPeriodRange', () => {
  it('uses property-local month boundaries across a DST transition', () => {
    expect(
      calendarPeriodRange(
        new Date('2026-03-15T12:00:00.000Z'),
        'America/New_York',
        'monthly',
      ),
    ).toEqual({
      start: new Date('2026-03-01T05:00:00.000Z'),
      end: new Date('2026-04-01T04:00:00.000Z'),
    })
  })

  it('uses Monday-start property-local weekly boundaries', () => {
    expect(
      calendarPeriodRange(
        new Date('2026-06-21T14:00:00.000Z'),
        'America/Los_Angeles',
        'weekly',
      ),
    ).toEqual({
      start: new Date('2026-06-15T07:00:00.000Z'),
      end: new Date('2026-06-22T07:00:00.000Z'),
    })
  })

  it('uses property-local quarter boundaries', () => {
    expect(
      calendarPeriodRange(
        new Date('2026-05-15T12:00:00.000Z'),
        'Asia/Tokyo',
        'quarterly',
      ),
    ).toEqual({
      start: new Date('2026-03-31T15:00:00.000Z'),
      end: new Date('2026-06-30T15:00:00.000Z'),
    })
  })

  it('reuses timezone formatting without changing boundaries', () => {
    const now = new Date('2026-06-18T12:00:00.000Z')

    expect(calendarPeriodRange(now, 'UTC', 'weekly')).toEqual(
      calendarPeriodRange(now, 'UTC', 'weekly'),
    )
  })

  // PostgreSQL's `AT TIME ZONE` resolves a repeated local time to the later,
  // standard-time instant, and the Goal monthly-result guard derives the month
  // it accepts that way. Havana's midnight on 1 November repeats (DST ends at
  // 01:00 CDT), so an app that picked the earlier instant wrote Octobers and
  // Novembers the database rejected.
  it('chooses the later, standard-time instant when a monthly midnight repeats', () => {
    expect(
      calendarPeriodRange(
        new Date('2015-11-15T12:00:00.000Z'),
        'America/Havana',
        'monthly',
      ).start,
    ).toEqual(new Date('2015-11-01T05:00:00.000Z'))
  })

  it('ends a month at the instant PostgreSQL gives a repeated midnight', () => {
    expect(
      calendarPeriodRange(
        new Date('2026-10-15T12:00:00.000Z'),
        'America/Havana',
        'monthly',
      ),
    ).toEqual({
      start: new Date('2026-10-01T04:00:00.000Z'),
      end: new Date('2026-11-01T05:00:00.000Z'),
    })
  })

  it('rejects a monthly boundary skipped by a midnight DST transition', () => {
    expect(() =>
      calendarPeriodRange(
        new Date('2014-08-15T12:00:00.000Z'),
        'Africa/Cairo',
        'monthly',
      ),
    ).toThrow(/Unresolvable calendar boundary/)
  })
})
