import { describe, expect, it } from 'vitest'
import { createVersionedHmacKeyring } from './versioned-hmac-keyring'

describe('versioned HMAC keyring', () => {
  it('signs with the first key and verifies retained keys by audience', () => {
    const old = createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`)
    const oldDigest = old.sign('oauth-state', 'value')
    const rotated = createVersionedHmacKeyring(
      `v2:${'22'.repeat(32)},v1:${'11'.repeat(32)}`,
    )

    expect(rotated.activeVersion).toBe('v2')
    expect(rotated.retainedVersions).toEqual(['v1'])
    expect(
      rotated.verify('oauth-state', 'value', oldDigest.keyVersion, oldDigest.digest),
    ).toBe(true)
    expect(
      rotated.verify(
        'different-audience',
        'value',
        oldDigest.keyVersion,
        oldDigest.digest,
      ),
    ).toBe(false)
  })

  it('derives lookup digests with retained versions without exposing key material', () => {
    const rotated = createVersionedHmacKeyring(
      `v2:${'22'.repeat(32)},v1:${'11'.repeat(32)}`,
    )

    const oldDigest = rotated.derive('opaque-reference', 'v1.handle', 'v1')
    expect(oldDigest).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(rotated.verify('opaque-reference', 'v1.handle', 'v1', oldDigest!)).toBe(true)
    expect(rotated.derive('opaque-reference', 'v0.handle', 'v0')).toBeNull()
  })

  it.each([
    ['', /empty or malformed/],
    [`v1:${'11'.repeat(31)}`, /entry is malformed/],
    [`V1:${'11'.repeat(32)}`, /entry is malformed/],
    [`v1:${'11'.repeat(32)},v1:${'22'.repeat(32)}`, /version is duplicated/],
  ])('rejects malformed keyring %j', (raw, expectedMessage) => {
    expect(() => createVersionedHmacKeyring(raw)).toThrow(expectedMessage)
  })
})
