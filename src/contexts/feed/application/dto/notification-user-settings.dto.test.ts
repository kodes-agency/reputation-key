import { describe, expect, it } from 'vitest'
import { notificationUserSettingsDto } from './notification-user-settings.dto'

describe('notificationUserSettingsDto', () => {
  it.each([
    { locale: 'en', timezone: 'UTC' },
    { locale: 'bg-BG', timezone: 'Europe/Sofia' },
    { locale: 'en-US', timezone: 'America/New_York' },
  ])('accepts supported formatting settings: $locale / $timezone', (value) => {
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

  it.each([
    { locale: '', timezone: 'UTC' },
    { locale: 'english', timezone: 'UTC' },
    { locale: 'en', timezone: 'Sofia' },
    { locale: 'en', timezone: '' },
    {},
  ])('rejects malformed formatting settings: %o', (value) => {
    expect(notificationUserSettingsDto.safeParse(value).success).toBe(false)
  })
})
