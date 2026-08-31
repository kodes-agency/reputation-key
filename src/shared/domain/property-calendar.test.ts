import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  daysInGregorianMonth,
  propertyWallClockAt,
  propertyWallClockToInstant,
  shiftPropertyLocalDays,
} from './property-calendar'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Property wall-clock conversion', () => {
  it('rejects an invalid source instant', () => {
    expect(() => propertyWallClockAt(new Date('invalid'), 'UTC')).toThrow(
      'Invalid calendar instant',
    )
  })

  it('defaults a formatter part that is unavailable in the host runtime', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts').mockReturnValue([
      { type: 'year', value: '2026' },
      { type: 'month', value: '8' },
      { type: 'day', value: '27' },
      { type: 'hour', value: '24' },
      { type: 'minute', value: '15' },
      { type: 'second', value: '30' },
    ])

    expect(propertyWallClockAt(new Date('2026-08-27T00:00:00.000Z'), 'UTC')).toEqual({
      year: 2026,
      month: 8,
      day: 27,
      hour: 0,
      minute: 15,
      second: 30,
      millisecond: 0,
    })
  })

  it('chooses the earlier instant when a local time occurs twice in an autumn fold', () => {
    expect(
      propertyWallClockToInstant(
        {
          year: 2026,
          month: 11,
          day: 1,
          hour: 1,
          minute: 30,
          second: 0,
          millisecond: 0,
        },
        'America/New_York',
      ),
    ).toEqual(new Date('2026-11-01T05:30:00.000Z'))
  })

  it('advances a nonexistent spring-gap time to the first representable minute', () => {
    expect(
      propertyWallClockToInstant(
        {
          year: 2026,
          month: 3,
          day: 8,
          hour: 2,
          minute: 30,
          second: 0,
          millisecond: 0,
        },
        'America/New_York',
      ),
    ).toEqual(new Date('2026-03-08T07:00:00.000Z'))
  })

  it('refuses a wall clock that remains unrepresentable beyond the bounded gap policy', () => {
    expect(() =>
      propertyWallClockToInstant(
        {
          year: 2011,
          month: 12,
          day: 30,
          hour: 12,
          minute: 0,
          second: 0,
          millisecond: 0,
        },
        'Pacific/Apia',
      ),
    ).toThrow('Unable to resolve wall clock in timezone Pacific/Apia')
  })
})

describe('Gregorian month length', () => {
  it('handles leap years and ordinary month lengths', () => {
    expect(daysInGregorianMonth(2024, 2)).toBe(29)
    expect(daysInGregorianMonth(2025, 2)).toBe(28)
    expect(daysInGregorianMonth(2025, 4)).toBe(30)
    expect(daysInGregorianMonth(2025, 1)).toBe(31)
  })
})

describe('Property-local calendar arithmetic', () => {
  it('preserves local wall-clock time across the spring DST transition', () => {
    const noonAfterSpringForward = new Date('2026-03-08T16:00:00.000Z')

    expect(
      shiftPropertyLocalDays(noonAfterSpringForward, -1, 'America/New_York'),
    ).toEqual(new Date('2026-03-07T17:00:00.000Z'))
  })

  it('preserves local wall-clock time across the autumn DST transition', () => {
    const noonAfterFallBack = new Date('2026-11-01T17:00:00.000Z')

    expect(shiftPropertyLocalDays(noonAfterFallBack, -1, 'America/New_York')).toEqual(
      new Date('2026-10-31T16:00:00.000Z'),
    )
  })

  it('preserves sub-second precision at rolling-window boundaries', () => {
    const instant = new Date('2026-03-20T16:00:00.347Z')

    expect(shiftPropertyLocalDays(instant, -30, 'America/New_York')).toEqual(
      new Date('2026-02-18T17:00:00.347Z'),
    )
  })

  it('rejects fractional calendar-day arithmetic', () => {
    expect(() =>
      shiftPropertyLocalDays(new Date('2026-03-20T16:00:00.000Z'), 0.5, 'UTC'),
    ).toThrow('Calendar days must be an integer')
  })
})
