import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  loadEd25519PrivateKey,
  loadEd25519PublicKeyring,
  loadSafetyIdentifierKey,
} from './key-material'

function encodedKeyPair() {
  const pair = generateKeyPairSync('ed25519')
  return {
    privateKey: pair.privateKey
      .export({ format: 'der', type: 'pkcs8' })
      .toString('base64'),
    publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  }
}

describe('AI gateway key material', () => {
  it('loads the exact sealed active admission verification key', () => {
    const first = encodedKeyPair()
    expect(loadEd25519PrivateKey(first.privateKey).asymmetricKeyType).toBe('ed25519')
    const keyring = loadEd25519PublicKeyring(
      JSON.stringify({ 'admission-v1': first.publicKey }),
    )
    expect([...keyring.keys()]).toEqual(['admission-v1'])
    expect(
      [...keyring.values()].every((key) => key.asymmetricKeyType === 'ed25519'),
    ).toBe(true)
  })

  it.each([
    '{}',
    '[]',
    'null',
    JSON.stringify({ Bad: 'not-base64' }),
    JSON.stringify({ 'admission-v1': 'AQ==' }),
    JSON.stringify({ active: encodedKeyPair().publicKey }),
    JSON.stringify({
      'admission-v1': encodedKeyPair().publicKey,
      retiring: encodedKeyPair().publicKey,
    }),
  ])('rejects invalid public keyring %s', (value) => {
    expect(() => loadEd25519PublicKeyring(value)).toThrow(
      'AI gateway public keyring is invalid',
    )
  })

  it('rejects duplicate public key IDs before key import', () => {
    const { publicKey } = encodedKeyPair()
    expect(() =>
      loadEd25519PublicKeyring(
        `{"admission-v1":${JSON.stringify(publicKey)},"admission-v1":${JSON.stringify(publicKey)}}`,
      ),
    ).toThrow('AI gateway public keyring is invalid')
  })
  it('rejects oversized key material before import', () => {
    expect(() =>
      loadEd25519PublicKeyring(JSON.stringify({ 'admission-v1': 'A'.repeat(16_385) })),
    ).toThrow('AI gateway key material is invalid')
  })

  it('loads only one canonical 32-byte safety key', () => {
    const loaded = loadSafetyIdentifierKey(`safety-v1:${'ab'.repeat(32)}`)
    expect(loaded.version).toBe('safety-v1')
    expect(loaded.key.byteLength).toBe(32)
    expect(() =>
      loadSafetyIdentifierKey(`v1:${'ab'.repeat(32)},v0:${'cd'.repeat(32)}`),
    ).toThrow()
    loaded.key.fill(0)
  })
})
