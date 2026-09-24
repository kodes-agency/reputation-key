import { describe, expect, it } from 'vitest'
import {
  NOTIFICATION_LOCALES,
  notificationFormattingFormDto,
  notificationUserSettingsDto,
} from './notification-user-settings.dto'

describe('notificationUserSettingsDto', () => {
  it.each([
    { locale: 'en', timezone: 'UTC' },
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

  // Runtimes spell some zones differently: Safari and Firefox list the current
  // IANA names, while Node (the server) and Chrome list the older ones
  // (Asia/Calcutta, Europe/Kiev). A zone picked in the browser must pass the
  // server's check, not only the browser's own list.
  it.each([
    'Asia/Kolkata',
    'Europe/Kyiv',
    'Asia/Ho_Chi_Minh',
    'Asia/Kathmandu',
    'America/Nuuk',
    'America/Argentina/Buenos_Aires',
    'Asia/Calcutta',
    'Europe/Kiev',
  ])('accepts a zone in either spelling the pickers offer: %s', (timezone) => {
    expect(notificationUserSettingsDto.safeParse({ timezone })).toEqual({
      success: true,
      data: { timezone },
    })
  })

  // Intl resolves most of these, which is what the old check asked. A fixed
  // offset has no daylight saving, so from late October a Sofia user's quiet
  // hours and 08:00 digest would run an hour off; the picker never offers one.
  it.each([
    '+03:00',
    'Etc/GMT-3',
    'EST',
    'utc',
    'europe/sofia',
    'Europe/sofia',
    'US/Eastern',
    'Sofia',
    'Europe/Atlantis',
  ])('rejects a timezone the picker does not offer: %s', (timezone) => {
    expect(notificationUserSettingsDto.safeParse({ timezone }).success).toBe(false)
  })

  // Every word in the product is English, so the control chooses between
  // English conventions and nothing else (docs/BETA.md).
  it.each(['', 'english', 'xx', 'de-DE', 'bg'])(
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

describe('notificationFormattingFormDto', () => {
  // A value saved before the pickers existed, still in effect.
  const legacy = notificationFormattingFormDto({ locale: 'de-DE', timezone: '+03:00' })

  it('checks only what changed, so an untouched legacy value never blocks a save', () => {
    expect(legacy.safeParse({ locale: 'de-DE', timezone: 'Europe/Sofia' })).toEqual({
      success: true,
      data: { timezone: 'Europe/Sofia' },
    })
  })

  it('refuses a changed value on the field it concerns', () => {
    const result = notificationFormattingFormDto({
      locale: 'en',
      timezone: 'Europe/Sofia',
    }).safeParse({ locale: 'en', timezone: 'Etc/GMT-3' })

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['timezone']])
  })
})
