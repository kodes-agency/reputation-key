import { describe, expect, it } from 'vitest'
import { DEFAULT_NOTIFICATION_FORMAT, formatAbsoluteTime } from './notification-utils'

const STAMP = new Date('2026-09-21T08:00:00.000Z')

describe('formatAbsoluteTime', () => {
  it('names the zone the time is shown in', () => {
    // 11:00 in Sofia. Without the zone, a reader cannot tell whether the
    // tooltip is in their time or some other clock.
    expect(formatAbsoluteTime(STAMP, { locale: 'en', timeZone: 'Europe/Sofia' })).toBe(
      'Sep 21, 2026, 11:00 AM GMT+3',
    )
  })

  it('says UTC while the settings have not loaded yet', () => {
    expect(formatAbsoluteTime(STAMP, DEFAULT_NOTIFICATION_FORMAT)).toBe(
      'Sep 21, 2026, 8:00 AM UTC',
    )
  })
})
