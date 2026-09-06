// The version prefix is the whole point of this adapter's format: it is what
// lets a key be rotated without making rows sealed by the previous key
// unreadable. These cases assert that property, and the two ways it can be
// broken — an unknown version, and a relabelled ciphertext.

import { describe, expect, it } from 'vitest'
import { createTokenEncryptionAdapter } from './token-encryption.adapter'

const V1_KEY = '11'.repeat(32)
const V2_KEY = '22'.repeat(32)
const TOKEN = 'ya29.a0-refresh-token-material'

describe('token encryption adapter', () => {
  it('round-trips under the active version and labels the ciphertext with it', () => {
    const adapter = createTokenEncryptionAdapter({
      activeVersion: 'v1',
      keys: { v1: V1_KEY },
    })

    const sealed = adapter.encrypt(TOKEN)

    expect(sealed.startsWith('v1:')).toBe(true)
    expect(sealed.split(':')).toHaveLength(4)
    expect(sealed).not.toContain(TOKEN)
    expect(adapter.decrypt(sealed)).toBe(TOKEN)
  })

  it('reads a v1 ciphertext while v2 is the active key', () => {
    // The rotation this format exists for: v2 seals new rows, v1 rows still
    // read. Without the version prefix the v1 row would fail its GCM tag check
    // under the v2 key and be indistinguishable from tampering.
    const beforeRotation = createTokenEncryptionAdapter({
      activeVersion: 'v1',
      keys: { v1: V1_KEY },
    })
    const sealedUnderV1 = beforeRotation.encrypt(TOKEN)

    const afterRotation = createTokenEncryptionAdapter({
      activeVersion: 'v2',
      keys: { v1: V1_KEY, v2: V2_KEY },
    })

    expect(afterRotation.decrypt(sealedUnderV1)).toBe(TOKEN)
    expect(afterRotation.encrypt(TOKEN).startsWith('v2:')).toBe(true)
  })

  it('refuses a ciphertext whose version it holds no key for', () => {
    const adapter = createTokenEncryptionAdapter({
      activeVersion: 'v2',
      keys: { v2: V2_KEY },
    })
    const sealedUnderV1 = createTokenEncryptionAdapter({
      activeVersion: 'v1',
      keys: { v1: V1_KEY },
    }).encrypt(TOKEN)

    expect(() => adapter.decrypt(sealedUnderV1)).toThrow(/Unknown key version/u)
  })

  it('refuses a ciphertext relabelled to a version it does hold', () => {
    // The version is bound as AAD, so swapping the label to a key the adapter
    // holds does not let the tag verify — it fails instead of decrypting
    // material under the wrong key.
    const adapter = createTokenEncryptionAdapter({
      activeVersion: 'v1',
      keys: { v1: V1_KEY, v2: V2_KEY },
    })
    const [, iv, tag, body] = adapter.encrypt(TOKEN).split(':')

    // GCM rejects it at tag verification, so the failure comes from the cipher
    // rather than our format check — naming it is what distinguishes a real
    // authentication failure from a typo in this test's own reassembly.
    expect(() => adapter.decrypt(['v2', iv, tag, body].join(':'))).toThrow(
      /unable to authenticate data/u,
    )
  })

  it('refuses the legacy unversioned three-part format', () => {
    const adapter = createTokenEncryptionAdapter({
      activeVersion: 'v1',
      keys: { v1: V1_KEY },
    })
    const [, iv, tag, body] = adapter.encrypt(TOKEN).split(':')

    expect(() => adapter.decrypt([iv, tag, body].join(':'))).toThrow(
      /Invalid ciphertext format/u,
    )
  })

  it('refuses a configuration whose active version has no key', () => {
    expect(() =>
      createTokenEncryptionAdapter({ activeVersion: 'v2', keys: { v1: V1_KEY } }),
    ).toThrow(/Invalid encryption key configuration/u)
  })

  it('refuses a key that is not 32 bytes', () => {
    expect(() =>
      createTokenEncryptionAdapter({
        activeVersion: 'v1',
        keys: { v1: '11'.repeat(16) },
      }),
    ).toThrow(/Invalid encryption key configuration/u)
  })

  it('refuses a version label containing the field separator', () => {
    // A colon in the version would make the four-part split ambiguous, so a
    // ciphertext could be parsed with the wrong boundaries.
    expect(() =>
      createTokenEncryptionAdapter({ activeVersion: 'v:1', keys: { 'v:1': V1_KEY } }),
    ).toThrow(/Invalid encryption key configuration/u)
  })
})
