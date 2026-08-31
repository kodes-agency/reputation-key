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

  it.each([
    { locale: '', timezone: 'UTC' },
    { locale: 'english', timezone: 'UTC' },
    { locale: 'en', timezone: 'Sofia' },
    { locale: 'en', timezone: '' },
  ])('rejects malformed formatting settings: $locale / $timezone', (value) => {
    expect(notificationUserSettingsDto.safeParse(value).success).toBe(false)
  })
})
