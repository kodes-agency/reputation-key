// One module formats every date and number the interface prints. The cases
// pin what makes it safe to share: a fixed locale (so the server and the browser
// print the same text), a named zone (UTC unless a caller says otherwise), and a
// real answer, never a throw, for an instant that is not one.
import { describe, expect, it } from 'vitest'
import {
  formatClock,
  formatDate,
  formatDayKey,
  formatLocalDate,
  formatLongDate,
  formatMonthDay,
  formatMonthName,
  formatMonthYear,
  formatNumber,
  formatShortDate,
  formatTime,
  formatTimestamp,
  toInstant,
} from './format'

const NOON_UTC = new Date('2026-09-12T12:30:00.000Z')

describe('toInstant', () => {
  it('accepts a Date, an ISO string and epoch milliseconds', () => {
    expect(toInstant(NOON_UTC)?.getTime()).toBe(NOON_UTC.getTime())
    expect(toInstant('2026-09-12T12:30:00.000Z')?.getTime()).toBe(NOON_UTC.getTime())
    expect(toInstant(NOON_UTC.getTime())?.getTime()).toBe(NOON_UTC.getTime())
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an unparsable string', 'not a date'],
    ['an Invalid Date', new Date(Number.NaN)],
    ['NaN', Number.NaN],
  ])('is null for %s', (_label, value) => {
    expect(toInstant(value)).toBeNull()
  })
})

describe('formatDate', () => {
  it('prints month-first, in UTC, for the same instant on every machine', () => {
    expect(formatDate(NOON_UTC)).toBe('Sep 12, 2026')
  })

  it('reads the calendar day in the zone it is given', () => {
    const lateEvening = new Date('2026-09-12T23:30:00.000Z')

    expect(formatDate(lateEvening)).toBe('Sep 12, 2026')
    expect(formatDate(lateEvening, 'Pacific/Auckland')).toBe('Sep 13, 2026')
  })

  it('is null for something that is not an instant', () => {
    expect(formatDate(new Date(Number.NaN))).toBeNull()
    expect(formatDate(null)).toBeNull()
    expect(formatDate('')).toBeNull()
  })
})

describe('the other date shapes', () => {
  it('prints a month and day', () => {
    expect(formatMonthDay(NOON_UTC)).toBe('Sep 12')
  })

  it('prints a month by name', () => {
    expect(formatMonthName(NOON_UTC)).toBe('September')
  })

  it('prints a whole month', () => {
    expect(formatMonthYear(NOON_UTC)).toBe('September 2026')
  })

  it('prints a long date', () => {
    expect(formatLongDate(NOON_UTC)).toBe('September 12, 2026')
  })

  it('prints a clock time', () => {
    expect(formatTime(NOON_UTC)).toBe('12:30 PM')
    expect(formatTime(NOON_UTC, 'America/New_York')).toBe('8:30 AM')
  })

  it('prints a clock time down to the second for a live status line', () => {
    expect(formatClock(new Date('2026-09-12T12:30:05.000Z'))).toBe('12:30:05 PM')
  })

  it('joins the date and the time with a comma on every engine', () => {
    // WebKit's own glue would read "Sep 12, 2026 at 12:30 PM".
    expect(formatTimestamp(NOON_UTC)).toBe('Sep 12, 2026, 12:30 PM')
    expect(formatTimestamp(NOON_UTC, 'Europe/Sofia')).toBe('Sep 12, 2026, 3:30 PM')
  })

  it.each([
    formatMonthDay,
    formatMonthName,
    formatMonthName,
    formatMonthYear,
    formatLongDate,
    formatTime,
    formatClock,
    formatTimestamp,
  ])('answers null rather than throwing for an Invalid Date', (format) => {
    expect(format(new Date(Number.NaN))).toBeNull()
  })
})

describe('formatLocalDate', () => {
  it('prints a stored calendar day as that day, whatever zone the reader is in', () => {
    expect(formatLocalDate('2026-09-12')).toBe('Sep 12, 2026')
  })

  it('can leave the year out for a day inside the period the page is about', () => {
    expect(formatLocalDate('2026-09-12', { year: false })).toBe('Sep 12')
  })

  it.each(['', 'yesterday', '2026-13-45'])('is null for %j', (value) => {
    expect(formatLocalDate(value)).toBeNull()
  })
})

describe('formatShortDate', () => {
  const SOFIA = 'Europe/Sofia'

  it('leaves the year out for a day in the year the reader is in', () => {
    const day = new Date('2026-10-11T09:00:00.000Z')

    expect(formatShortDate(day, SOFIA, new Date('2026-10-20T09:00:00.000Z'))).toBe(
      'Oct 11',
    )
  })

  it('prints the year of a day in another year', () => {
    const day = new Date('2025-12-20T09:00:00.000Z')

    expect(formatShortDate(day, SOFIA, new Date('2026-01-05T09:00:00.000Z'))).toBe(
      'Dec 20, 2025',
    )
  })

  it('reads the day and both years in the zone it is given', () => {
    // 22:30 UTC on 31 Dec is already 1 Jan 2027 in Sofia.
    const day = new Date('2026-12-31T22:30:00.000Z')
    const now = new Date('2027-01-05T09:00:00.000Z')

    expect(formatShortDate(day, SOFIA, now)).toBe('Jan 1')
    expect(formatShortDate(day, 'UTC', now)).toBe('Dec 31, 2026')
  })

  it('is null for something that is not an instant', () => {
    expect(formatShortDate(new Date(Number.NaN), SOFIA, new Date())).toBeNull()
  })
})

describe('formatDayKey', () => {
  it('names the calendar day an instant falls on in a zone, as a sortable key', () => {
    const lateEvening = new Date('2026-09-12T23:30:00.000Z')

    expect(formatDayKey(lateEvening)).toBe('2026-09-12')
    expect(formatDayKey(lateEvening, 'Europe/Sofia')).toBe('2026-09-13')
  })

  it('is null for something that is not an instant', () => {
    expect(formatDayKey(new Date(Number.NaN))).toBeNull()
  })
})

describe("the viewer's own zone", () => {
  it('is only used when a caller asks for it by name', () => {
    const viewer = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(NOON_UTC)

    expect(formatTime(NOON_UTC, 'viewer')).toBe(viewer)
  })
})

describe('formatNumber', () => {
  it('groups thousands the same way for every viewer', () => {
    expect(formatNumber(1234567)).toBe('1,234,567')
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(-4200)).toBe('-4,200')
  })

  it('rounds to the digits it is given and drops trailing zeros', () => {
    expect(formatNumber(12.345, { maximumFractionDigits: 1 })).toBe('12.3')
    expect(formatNumber(12, { maximumFractionDigits: 1 })).toBe('12')
  })

  it('keeps a fixed number of digits when asked for a minimum', () => {
    expect(formatNumber(3, { minimumFractionDigits: 2 })).toBe('3.00')
  })

  it('prints money in dollars', () => {
    expect(formatNumber(1234.5, { style: 'currency', currency: 'USD' })).toBe('$1,234.50')
  })
})
