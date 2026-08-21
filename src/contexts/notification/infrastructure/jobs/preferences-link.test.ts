import { describe, expect, it } from 'vitest'
import {
  assertPreferencesLink,
  mailClassForCategory,
  PREFERENCES_PATH,
  requiresPreferencesLink,
  unsubscribeHeaders,
} from './preferences-link'

const URL = 'https://app.example.com/settings/notifications'

describe('mail class', () => {
  it('treats only mandatory notifications as legally-required mail', () => {
    expect(mailClassForCategory('mandatory')).toBe('mandatory')
    for (const category of [
      'urgent_operational',
      'workflow_collaboration',
      'recognition',
    ] as const) {
      expect(mailClassForCategory(category)).toBe('optional')
    }
  })
})

describe('preferences link guard (ADR 0046 r.7)', () => {
  it('refuses to send optional email without a usable preferences link', () => {
    for (const url of ['', '   ', '/settings/notifications']) {
      expect(() => assertPreferencesLink('optional', url)).toThrow(
        expect.objectContaining({
          _tag: 'NotificationError',
          code: 'email_send_failed',
          message: expect.stringContaining('ADR 0046 r.7'),
        }),
      )
    }
  })

  it('accepts an absolute preferences URL', () => {
    expect(assertPreferencesLink('optional', URL)).toBe(URL)
  })

  it('exempts mandatory mail, which has no off switch to advertise', () => {
    expect(requiresPreferencesLink('mandatory')).toBe(false)
    expect(assertPreferencesLink('mandatory', '')).toBe('')
  })
})

describe('List-Unsubscribe headers (RFC 8058)', () => {
  it('emits no unsubscribe header at all for mandatory mail', () => {
    expect(unsubscribeHeaders('mandatory', URL)).toEqual({})
  })

  it('emits both the header and the one-click post directive for optional mail', () => {
    expect(unsubscribeHeaders('optional', URL)).toEqual({
      'List-Unsubscribe': `<${URL}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
  })
})

describe('preferences path', () => {
  it('pins the path the job and the renderer must share', () => {
    expect(PREFERENCES_PATH).toBe('/settings/notifications')
  })
})
