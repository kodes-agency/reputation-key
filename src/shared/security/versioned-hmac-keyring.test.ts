import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
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

  it('idempotently zeroes retained key bytes and rejects every post-dispose operation', () => {
    const keyring = createVersionedHmacKeyring(
      `v2:${'22'.repeat(32)},v1:${'11'.repeat(32)}`,
    )
    const digest = keyring.sign('audience', 'value')

    keyring.dispose()
    keyring.dispose()

    expect(() => keyring.sign('audience', 'value')).toThrow(/disposed/)
    expect(keyring.derive('audience', 'value', 'v2')).toBeNull()
    expect(keyring.verify('audience', 'value', digest.keyVersion, digest.digest)).toBe(
      false,
    )
  })

  it('zeroes keys decoded before a later keyring entry fails validation', () => {
    const fill = vi.spyOn(Buffer.prototype, 'fill')
    try {
      expect(() => createVersionedHmacKeyring(`v1:${'11'.repeat(32)},malformed`)).toThrow(
        /entry is malformed/,
      )
      expect(fill).toHaveBeenCalledWith(0)
    } finally {
      fill.mockRestore()
    }
  })

  it('rejects more than one retained online key', () => {
    expect(() =>
      createVersionedHmacKeyring(
        `v3:${'33'.repeat(32)},v2:${'22'.repeat(32)},v1:${'11'.repeat(32)}`,
      ),
    ).toThrow(/active-plus-retained/)
  })

  it('zeroes timing-safe comparison buffers for true and false verification', () => {
    const keyring = createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`)
    const signed = keyring.sign('audience', 'value')
    const fill = vi.spyOn(Buffer.prototype, 'fill')
    try {
      expect(keyring.verify('audience', 'value', signed.keyVersion, signed.digest)).toBe(
        true,
      )
      expect(
        keyring.verify('audience', 'different', signed.keyVersion, signed.digest),
      ).toBe(false)
      expect(fill.mock.calls.filter(([value]) => value === 0)).toHaveLength(4)
    } finally {
      fill.mockRestore()
      keyring.dispose()
    }
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
