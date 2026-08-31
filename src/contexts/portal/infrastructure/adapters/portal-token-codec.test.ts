import { describe, expect, it } from 'vitest'
import { createPortalTokenCodec } from './portal-token-codec'

describe('portal token codec', () => {
  it('issues a 256-bit opaque secret and stores only a keyed digest', () => {
    const chunks = [Buffer.alloc(12, 1), Buffer.alloc(32, 2)]
    const codec = createPortalTokenCodec({
      secret: 's'.repeat(32),
      randomBytes: () => chunks.shift()!,
    })

    const issued = codec.issue()

    expect(issued.rawToken).toMatch(/^pt_[A-Za-z0-9_-]{16}_[A-Za-z0-9_-]{43}$/)
    expect(issued.tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(issued.tokenHash).not.toContain(issued.rawToken)
    expect(codec.digest(issued.rawToken)).toEqual({
      tokenIdentifier: issued.tokenIdentifier,
      tokenHash: issued.tokenHash,
      tokenKeyVersion: 1,
    })
  })

  it('rejects malformed public tokens before repository lookup', () => {
    const codec = createPortalTokenCodec({
      secret: 's'.repeat(32),
      randomBytes: Buffer.alloc,
    })
    expect(codec.digest('portal-1')).toBeNull()
    expect(codec.digest('pt_short_secret')).toBeNull()
  })

  it('rejects weak hashing secrets', () => {
    expect(() =>
      createPortalTokenCodec({ secret: 'weak', randomBytes: Buffer.alloc }),
    ).toThrow('PORTAL_TOKEN_HASH_SECRET must contain at least 32 bytes')
  })
})
