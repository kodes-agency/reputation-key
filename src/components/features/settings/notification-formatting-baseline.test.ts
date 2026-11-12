import { describe, expect, it } from 'vitest'
import type { EffectiveNotificationSettings } from '#/contexts/feed/application/public-api'
import { formattingBaseline } from './notification-formatting-baseline'

const saved = {
  locale: 'en',
  timezone: 'Europe/Sofia',
  timezoneSource: 'user',
} as EffectiveNotificationSettings
const elsewhere = { ...saved, locale: 'en-GB' } as EffectiveNotificationSettings

describe('the timezone and format form baseline', () => {
  it('takes a newer read while the form holds no edit', () => {
    expect(formattingBaseline(saved, elsewhere, null)).toBe(elsewhere)
  })

  it('keeps an unsaved edit on the values it started from when another tab saves', () => {
    const draft = { locale: 'en', timezone: 'America/New_York' }
    expect(formattingBaseline(saved, elsewhere, draft)).toBe(saved)
  })

  it('takes the read that confirms the edit was saved', () => {
    const draft = { locale: 'en', timezone: 'America/New_York' }
    const confirmed = { ...saved, timezone: 'America/New_York' }
    expect(formattingBaseline(saved, confirmed, draft)).toBe(confirmed)
  })
})
