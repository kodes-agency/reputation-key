import { describe, expect, it } from 'vitest'
import { notificationEmailAddressKeys } from './read-and-notify-contexts'

const AUTH_SECRET = 'auth-secret-that-an-incident-rotates-0001'
const DEDICATED = 'dedicated-suppression-key-0000000000000001'

describe('notificationEmailAddressKeys', () => {
  it('keeps the auth secret as the key until a dedicated one is set', () => {
    expect(notificationEmailAddressKeys({ BETTER_AUTH_SECRET: AUTH_SECRET })).toEqual({
      notificationEmailAddressKey: AUTH_SECRET,
      retiredNotificationEmailAddressKeys: [],
    })
  })

  it('moves to the dedicated key and honours the auth secret as retired', () => {
    expect(
      notificationEmailAddressKeys({
        BETTER_AUTH_SECRET: AUTH_SECRET,
        NOTIFICATION_EMAIL_SUPPRESSION_KEY: DEDICATED,
      }),
    ).toEqual({
      notificationEmailAddressKey: DEDICATED,
      retiredNotificationEmailAddressKeys: [AUTH_SECRET],
    })
  })
})
