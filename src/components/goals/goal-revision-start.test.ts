import { describe, expect, it } from 'vitest'
import {
  goalRevisionScheduledMessage,
  goalRevisionStartDate,
} from './goal-revision-start'

// After the Property's timezone moves east, the revision can start a month
// later than "next month", so the start is stated as a date. It is the first
// instant of a Property-local month, which is still the previous day in UTC.
const sofiaMay = {
  effectiveFrom: new Date('2026-04-30T21:00:00.000Z'),
  propertyTimezone: 'Europe/Sofia',
}

describe('goal revision start', () => {
  it('dates the start in the Property timezone the version was cut in', () => {
    expect(goalRevisionStartDate(sofiaMay)).toBe('May 1, 2026')
  })

  it('says when the scheduled revision starts, and in which timezone', () => {
    expect(goalRevisionScheduledMessage(sofiaMay)).toBe(
      'Goal revision scheduled. It starts May 1, 2026 (Europe/Sofia).',
    )
  })
})
