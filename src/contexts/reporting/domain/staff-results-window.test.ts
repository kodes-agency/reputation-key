import { describe, expect, it } from 'vitest'
import { staffResultsWindow } from './staff-results-window'

describe('staff periods in the Property calendar', () => {
  it('cuts ratings at local midnight, including a DST day', () => {
    const result = staffResultsWindow(
      new Date('2026-11-01T19:00:00Z'),
      'America/New_York',
      'US',
      'week',
    )
    expect(result.ratingsCutoff.toISOString()).toBe('2026-11-01T04:00:00.000Z')
    expect(result.startAt.toISOString()).toBe('2026-11-01T04:00:00.000Z')
  })
  it('starts a US week on Sunday and other weeks on Monday', () => {
    const now = new Date('2026-11-04T16:00:00Z')
    expect(
      staffResultsWindow(now, 'Europe/Sofia', 'BG', 'week').startAt.toISOString(),
    ).toBe('2026-11-01T22:00:00.000Z')
    expect(
      staffResultsWindow(now, 'America/New_York', 'US', 'week').startAt.toISOString(),
    ).toBe('2026-11-01T04:00:00.000Z')
  })
})
