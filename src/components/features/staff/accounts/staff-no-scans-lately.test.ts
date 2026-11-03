import { describe, expect, it } from 'vitest'
import { staffNoScansLately, staffDaysSince } from './staff-no-scans-lately'
const now = new Date('2026-11-03T00:30:00Z')
const base = {
  access: 'active',
  joinedAt: '2026-10-20T22:00:00Z',
  lastScanAt: null,
  now,
  timeZone: 'Europe/Sofia',
}
describe('No scans lately', () => {
  it('uses Property days, not fourteen elapsed 24-hour periods across DST', () => {
    expect(staffNoScansLately(base)).toBe(false)
    expect(staffNoScansLately({ ...base, joinedAt: '2026-10-19T22:00:00Z' })).toBe(true)
    expect(staffDaysSince('2026-10-19T22:00:00Z', now, 'Europe/Sofia')).toBe(14)
  })
  it('does not mark someone who has not joined or whose join date is unknown', () => {
    expect(
      staffNoScansLately({ ...base, access: 'invited', joinedAt: '2026-09-01' }),
    ).toBe(false)
    expect(staffNoScansLately({ ...base, joinedAt: null })).toBe(false)
  })
  it('marks an old joined person with no scan, or one exactly fourteen Property days ago', () => {
    const old = { ...base, joinedAt: '2026-09-01' }
    expect(staffNoScansLately(old)).toBe(true)
    expect(staffNoScansLately({ ...old, lastScanAt: '2026-10-19T22:00:00Z' })).toBe(true)
    expect(staffNoScansLately({ ...old, lastScanAt: '2026-10-20T22:00:00Z' })).toBe(false)
    expect(staffNoScansLately({ ...old, lastScanAt: now })).toBe(false)
  })
})
