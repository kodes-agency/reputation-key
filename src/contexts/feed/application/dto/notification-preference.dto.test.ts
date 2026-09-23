import { describe, expect, it } from 'vitest'
import {
  notificationPreferenceCategory,
  updateNotificationPreferenceDto,
} from './notification-preference.dto'

describe('notification preference API contract', () => {
  it('refuses Organization mandatory policy on Property preference endpoints', () => {
    expect(notificationPreferenceCategory.safeParse('mandatory').success).toBe(false)
  })

  it.each(['urgent_operational', 'workflow_collaboration', 'recognition'] as const)(
    'accepts configurable Property category %s',
    (category) => {
      expect(notificationPreferenceCategory.safeParse(category).success).toBe(true)
    },
  )
})

describe('notification preference update contract', () => {
  const update = {
    propertyId: '10000000-0000-4000-8000-000000000001',
    category: 'urgent_operational',
    channel: 'email',
    enabled: true,
    cadence: 'immediate',
    urgentBypassEnabled: false,
  } as const

  it('accepts a quiet-hours window that spans midnight', () => {
    expect(
      updateNotificationPreferenceDto.safeParse({
        ...update,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
      }).success,
    ).toBe(true)
  })

  it('refuses a quiet-hours window that starts and ends at the same time', () => {
    expect(
      updateNotificationPreferenceDto.safeParse({
        ...update,
        quietHoursStart: '22:00',
        quietHoursEnd: '22:00',
      }).success,
    ).toBe(false)
  })
})
