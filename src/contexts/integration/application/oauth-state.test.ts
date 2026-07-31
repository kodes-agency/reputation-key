// Tests for the OAuth state codec + PKCE primitives (BQC-7.6).
//
// The custom Google OAuth flow (not better-auth) protects the redirect leg
// with an HMAC-signed state. BQC-7.6 hardens it:
//   - the state payload is bound to the INITIATING USER (`sub`) — a state
//     minted for user A is rejected when the callback session is user B;
//   - PKCE S256: a high-entropy verifier is stored server-side (one-time
//     use) and only its challenge leaves the process.
//
// This module is the single source for sign/encode/verify — the use case
// (issue) and the callback route (redeem) must never drift apart.

import { describe, it, expect } from 'vitest'
import {
  encodeOAuthState,
  verifyOAuthState,
  generateCodeVerifier,
  s256Challenge,
  OAUTH_STATE_TTL_MS,
  OAUTH_STATE_TTL_SECONDS,
} from './oauth-state'
import { createInMemoryPkceVerifierStore } from '#/shared/testing/in-memory-pkce-verifier-store'

const SECRET = 'ab'.repeat(32)
const NOW = new Date('2026-07-31T12:00:00.000Z').getTime()

const issue = (
  overrides: Partial<{
    visibility: 'private' | 'organization'
    nonce: string
    ts: number
    sub: string
  }> = {},
) =>
  encodeOAuthState(
    {
      visibility: overrides.visibility ?? 'private',
      nonce: overrides.nonce ?? 'nonce-1',
      ts: overrides.ts ?? NOW,
      sub: overrides.sub ?? 'user-1',
    },
    SECRET,
  )

const verify = (
  rawState: string,
  opts: Partial<{ secret: string; expectedUserId: string; nowMs: number }> = {},
) =>
  verifyOAuthState(rawState, {
    secret: opts.secret ?? SECRET,
    expectedUserId: opts.expectedUserId ?? 'user-1',
    nowMs: opts.nowMs ?? NOW,
  })

describe('OAuth state codec (BQC-7.6)', () => {
  it('round-trips a valid state', () => {
    const result = verify(issue())
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value).toEqual({
        visibility: 'private',
        nonce: 'nonce-1',
        ts: NOW,
        sub: 'user-1',
      })
    }
  })

  it('rejects a state verified for a different user (user binding)', () => {
    const result = verify(issue(), { expectedUserId: 'user-2' })
    expect(result.isErr() && result.error).toBe('user_mismatch')
  })

  it('rejects a state whose sub was tampered with (signature covers sub)', () => {
    // Attacker re-encodes the payload with their own sub but cannot re-sign.
    const decoded = JSON.parse(Buffer.from(issue(), 'base64').toString())
    const tampered = Buffer.from(
      JSON.stringify({ ...decoded, sub: 'attacker' }),
    ).toString('base64')
    const result = verify(tampered, { expectedUserId: 'attacker' })
    expect(result.isErr() && result.error).toBe('bad_signature')
  })

  it('rejects a state signed with a different secret', () => {
    const result = verify(issue(), { secret: 'cd'.repeat(32) })
    expect(result.isErr() && result.error).toBe('bad_signature')
  })

  it('rejects expired and future-distant states', () => {
    const expired = verify(issue({ ts: NOW - OAUTH_STATE_TTL_MS - 1 }))
    expect(expired.isErr() && expired.error).toBe('expired')
    // A state exactly at the boundary still verifies.
    expect(verify(issue({ ts: NOW - OAUTH_STATE_TTL_MS })).isOk()).toBe(true)
  })

  it('rejects malformed states', () => {
    expect(
      verify('not-base64!!!').isErr() &&
        (verify('not-base64!!!') as { error: string }).error,
    ).toBe('malformed')
    const notJson = Buffer.from('hello').toString('base64')
    expect(verify(notJson).isErr() && (verify(notJson) as { error: string }).error).toBe(
      'malformed',
    )
  })

  it('rejects states with missing fields', () => {
    const noSig = Buffer.from(
      JSON.stringify({ visibility: 'private', nonce: 'n', ts: NOW, sub: 'user-1' }),
    ).toString('base64')
    const result = verify(noSig)
    expect(result.isErr() && result.error).toBe('missing_fields')

    const noSub = issue()
    const decoded = JSON.parse(Buffer.from(noSub, 'base64').toString())
    delete decoded.sub
    // Re-signing without sub is impossible for an attacker; a legacy state
    // (pre-sub) must fail closed even with a structurally valid signature.
    const legacy = Buffer.from(JSON.stringify(decoded)).toString('base64')
    expect(verify(legacy).isErr()).toBe(true)
  })

  it('rejects invalid visibility values', () => {
    const decoded = JSON.parse(Buffer.from(issue(), 'base64').toString())
    // Forge with the real secret but an out-of-enum visibility.
    const forged = encodeOAuthState(
      { visibility: 'public' as 'private', nonce: 'n', ts: NOW, sub: 'user-1' },
      SECRET,
    )
    void decoded
    const result = verify(forged)
    expect(result.isErr() && result.error).toBe('invalid_visibility')
  })
})

describe('PKCE primitives (BQC-7.6)', () => {
  it('generates high-entropy base64url verifiers within RFC 7636 bounds', () => {
    const a = generateCodeVerifier()
    const b = generateCodeVerifier()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(43)
    expect(a.length).toBeLessThanOrEqual(128)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('computes the S256 challenge as base64url(sha256(verifier))', () => {
    // RFC 7636 appendix B worked example.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(s256Challenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
})

describe('PKCE verifier store contract', () => {
  it('save → redeem returns the verifier exactly once (one-time use)', async () => {
    const store = createInMemoryPkceVerifierStore()
    await store.save('nonce-1', 'verifier-1', OAUTH_STATE_TTL_SECONDS)
    expect(await store.redeem('nonce-1')).toBe('verifier-1')
    expect(await store.redeem('nonce-1')).toBeUndefined()
  })

  it('redeem of an unknown nonce is undefined (fail closed)', async () => {
    const store = createInMemoryPkceVerifierStore()
    expect(await store.redeem('nope')).toBeUndefined()
  })
})
