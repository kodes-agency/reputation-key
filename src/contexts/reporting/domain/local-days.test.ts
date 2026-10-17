// Property-local calendar days — read on the Property's calendar, then counted as dates.
import { describe, expect, it } from 'vitest'
import { addLocalDays, daysBetween, localDateOf } from './local-days'

const SOFIA = 'Europe/Sofia'
// Midnight opening Sep 1 in Sofia, still Aug 31 in UTC.
const SOFIA_SEP_1 = new Date('2026-08-31T21:00:00.000Z')

describe('local dates', () => {
  it('reads the date in the Property zone, not in UTC', () => {
    expect(localDateOf(SOFIA_SEP_1, SOFIA)).toBe('2026-09-01')
    expect(localDateOf(SOFIA_SEP_1, 'UTC')).toBe('2026-08-31')
  })

  it('adds days across month ends', () => {
    expect(addLocalDays('2026-08-30', 3)).toBe('2026-09-02')
    expect(addLocalDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('counts whole days between two dates, a clock change between them or not', () => {
    expect(daysBetween('2026-10-23', '2026-10-23')).toBe(0)
    // Sofia leaves summer time on Oct 25: still 4 calendar days.
    expect(daysBetween('2026-10-23', '2026-10-27')).toBe(4)
    expect(daysBetween('2026-11-01', '2026-10-31')).toBe(-1)
  })
})
