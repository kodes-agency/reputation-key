import { describe, expect, it } from 'vitest'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import { createGoogleCredentialBinder } from './credential-binding'

const KEY_V1 = `v1:${'11'.repeat(32)}`
const KEY_V2 = `v2:${'22'.repeat(32)}`
const MAX_CREDENTIAL_BYTES = 8 * 1024

describe('Google credential binder', () => {
  const bind = createGoogleCredentialBinder(createVersionedHmacKeyring(KEY_V1))

  it('binds a credential to a stable lowercase SHA-256 digest', () => {
    const binding = bind('access-token')

    expect(binding).toMatch(/^[a-f0-9]{64}$/u)
    expect(bind('access-token')).toBe(binding)
  })

  it('separates different credentials and never carries the credential', () => {
    const credential = 'ya29.secret-access-token'

    expect(bind(credential)).not.toBe(bind(`${credential}x`))
    expect(bind(credential)).not.toContain('secret')
  })

  it('binds to the active key version, so rotation changes the binding', () => {
    const rotated = createGoogleCredentialBinder(
      createVersionedHmacKeyring(`${KEY_V2},${KEY_V1}`),
    )

    expect(rotated('access-token')).not.toBe(bind('access-token'))
  })

  it('accepts a credential of exactly the byte limit and refuses one byte more', () => {
    expect(bind('a'.repeat(MAX_CREDENTIAL_BYTES))).toMatch(/^[a-f0-9]{64}$/u)
    expect(() => bind('a'.repeat(MAX_CREDENTIAL_BYTES + 1))).toThrow(
      'Google credential binding input is invalid',
    )
  })

  it('counts bytes, not characters, against the limit', () => {
    const twoByteCharacters = 'é'.repeat(MAX_CREDENTIAL_BYTES / 2)

    expect(bind(twoByteCharacters)).toMatch(/^[a-f0-9]{64}$/u)
    expect(() => bind(`${twoByteCharacters}é`)).toThrow(
      'Google credential binding input is invalid',
    )
  })

  it.each([
    ['empty', ''],
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['a buffer', Buffer.from('access-token')],
  ])('refuses %s without echoing it', (_label, value) => {
    expect(() => bind(value as unknown as string)).toThrow(
      'Google credential binding input is invalid',
    )
  })

  it('refuses to bind once the keyring is disposed', () => {
    const keyring = createVersionedHmacKeyring(KEY_V1)
    const disposedBind = createGoogleCredentialBinder(keyring)
    keyring.dispose()

    expect(() => disposedBind('access-token')).toThrow('HMAC keyring is disposed')
  })
})
