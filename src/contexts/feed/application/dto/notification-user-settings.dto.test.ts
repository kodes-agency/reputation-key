import { describe, expect, it } from 'vitest'
import {
  NOTIFICATION_LOCALES,
  notificationUserSettingsDto,
} from './notification-user-settings.dto'

describe('notificationUserSettingsDto', () => {
  it.each([
    { locale: 'en', timezone: 'UTC' },
    { locale: 'bg', timezone: 'Europe/Sofia' },
    { locale: 'en-GB', timezone: 'America/New_York' },
  ])('accepts offered formatting settings: $locale / $timezone', (value) => {
    expect(notificationUserSettingsDto.safeParse(value).success).toBe(true)
  })

  // A save carries only what the user changed, so an untouched timezone is
  // never written over the one delivery already uses.
  it.each([{ locale: 'en-GB' }, { timezone: 'Europe/Sofia' }])(
    'accepts a save that changes one setting: %o',
    (value) => {
      expect(notificationUserSettingsDto.safeParse(value)).toEqual({
        success: true,
        data: value,
      })
    },
  )

  // Intl resolves all of these, which is what the old check asked. A fixed
  // offset has no daylight saving, so from late October a Sofia user's quiet
  // hours and 08:00 digest would run an hour off; the picker never offers one.
  it.each(['+03:00', 'Etc/GMT-3', 'EST', 'utc', 'europe/sofia', 'US/Eastern', 'Sofia'])(
    'rejects a timezone the picker does not offer: %s',
    (timezone) => {
      expect(notificationUserSettingsDto.safeParse({ timezone }).success).toBe(false)
    },
  )

  it.each(['', 'english', 'xx', 'de-DE'])(
    'rejects a locale the settings page does not offer: %s',
    (locale) => {
      expect(notificationUserSettingsDto.safeParse({ locale }).success).toBe(false)
    },
  )

  it('rejects a save that changes nothing', () => {
    expect(notificationUserSettingsDto.safeParse({}).success).toBe(false)
  })

  it('offers only locales the runtime can format', () => {
    for (const locale of NOTIFICATION_LOCALES) {
      expect(Intl.DateTimeFormat.supportedLocalesOf([locale])).toEqual([locale])
    }
  })
})
