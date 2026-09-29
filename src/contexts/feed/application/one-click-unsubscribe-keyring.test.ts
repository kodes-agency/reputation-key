// A keyring pasted as the bare output of `openssl rand -hex 32` (no `vN:`)
// used to pass boot, which checked only that the variable was set. Every
// optional email then threw while composing its unsubscribe link, digests
// failed until their rows went stale, and every RFC 8058 POST answered 500.
// The worker now refuses to boot, and the endpoint says it is unavailable.

import { describe, expect, it } from 'vitest'
import { unsubscribeKeysConfigError } from './one-click-unsubscribe-token'

const WELL_FORMED = `v1:${'11'.repeat(32)}`
const BARE_HEX = '11'.repeat(32)

describe('unsubscribeKeysConfigError', () => {
  it('accepts a well-formed keyring', () => {
    expect(
      unsubscribeKeysConfigError({ sendEmailEnabled: true, rawKeys: WELL_FORMED }),
    ).toBe(null)
  })

  it('refuses email without a keyring, as before', () => {
    expect(
      unsubscribeKeysConfigError({ sendEmailEnabled: true, rawKeys: undefined }),
    ).toBe('[CONFIG] notification.send_email requires NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS')
  })

  it('refuses a keyring it cannot parse, naming the problem and never the value', () => {
    const error = unsubscribeKeysConfigError({
      sendEmailEnabled: true,
      rawKeys: BARE_HEX,
    })

    expect(error).toBe(
      '[CONFIG] NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS is unusable: HMAC keyring entry is malformed',
    )
    expect(error).not.toContain(BARE_HEX)
  })

  it('says nothing while email is off', () => {
    expect(
      unsubscribeKeysConfigError({ sendEmailEnabled: false, rawKeys: BARE_HEX }),
    ).toBe(null)
  })
})
