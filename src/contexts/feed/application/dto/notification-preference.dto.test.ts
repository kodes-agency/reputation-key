import { describe, expect, it } from 'vitest'
import {
  notificationPreferenceCategory,
  notificationQuietHoursDto,
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
  } as const

  it('accepts one property row', () => {
    expect(updateNotificationPreferenceDto.safeParse(update).success).toBe(true)
  })

  it('accepts the same answer for every property the person has', () => {
    const parsed = updateNotificationPreferenceDto.safeParse({
      ...update,
      applyToAllProperties: true,
    })

    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.applyToAllProperties).toBe(true)
  })

  it('no longer carries quiet hours, which belong to the person', () => {
    const parsed = updateNotificationPreferenceDto.safeParse({
      ...update,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
    })

    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data).not.toHaveProperty('quietHoursStart')
  })
})

describe('quiet hours contract', () => {
  const PROPERTY = '10000000-0000-4000-8000-000000000001'

  it('accepts a personal window that spans midnight', () => {
    expect(
      notificationQuietHoursDto.safeParse({
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
        urgentBypassEnabled: true,
      }).success,
    ).toBe(true)
  })

  it('refuses a window that starts and ends at the same time', () => {
    expect(
      notificationQuietHoursDto.safeParse({
        quietHoursStart: '22:00',
        quietHoursEnd: '22:00',
      }).success,
    ).toBe(false)
  })

  it('refuses half a window', () => {
    expect(
      notificationQuietHoursDto.safeParse({
        quietHoursStart: '22:00',
        quietHoursEnd: null,
      }).success,
    ).toBe(false)
  })

  it('accepts a property override that holds nothing back', () => {
    expect(
      notificationQuietHoursDto.safeParse({
        propertyId: PROPERTY,
        quietHoursStart: null,
        quietHoursEnd: null,
        urgentBypassEnabled: false,
      }).success,
    ).toBe(true)
  })

  it('lets a property follow the person again', () => {
    expect(
      notificationQuietHoursDto.safeParse({ propertyId: PROPERTY, follow: true }).success,
    ).toBe(true)
  })

  it('refuses to make the person themselves follow something', () => {
    expect(notificationQuietHoursDto.safeParse({ follow: true }).success).toBe(false)
  })
})
