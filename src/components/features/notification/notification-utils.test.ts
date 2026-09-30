import { UserCog, UserPlus } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NOTIFICATION_FORMAT,
  formatAbsoluteTime,
  formatCompactTime,
  getNotificationIcon,
} from './notification-utils'

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

describe('formatCompactTime', () => {
  const at = (ms: number) => new Date(STAMP.getTime() + ms)
  const MIN = 60_000

  it.each([
    [30_000, 'now'],
    [12 * MIN, '12m'],
    [3 * 60 * MIN, '3h'],
    [2 * 24 * 60 * MIN, '2d'],
  ])('writes %i ms ago as %s', (ago, expected) => {
    expect(formatCompactTime(STAMP, DEFAULT_NOTIFICATION_FORMAT, at(ago))).toBe(expected)
  })

  it("names the date, in the reader's zone, once a week has passed", () => {
    const late = new Date('2026-09-21T23:30:00.000Z')
    expect(
      formatCompactTime(
        late,
        { locale: 'en', timeZone: 'Europe/Sofia' },
        at(10 * 24 * 60 * MIN),
      ),
    ).toBe('Sep 22')
  })
})

describe('getNotificationIcon', () => {
  it('gives the property-access notice the permissions icon and the accepted invitation a person', () => {
    expect(getNotificationIcon('account.organization_property_access_changed')).toBe(
      UserCog,
    )
    expect(getNotificationIcon('account.invitation_accepted')).toBe(UserPlus)
  })
})
