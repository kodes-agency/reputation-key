// Integration context — get Google auth URL use case tests (BQC-7.6).
//
// Pins the hardened authorization URL contract: user-bound HMAC state and
// PKCE S256 (verifier stored server-side under the state nonce, only the
// challenge leaves the process).

import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { getGoogleAuthUrl } from './get-google-auth-url'
import { verifyOAuthState, OAUTH_STATE_TTL_SECONDS } from '../oauth-state'
import { createInMemoryPkceVerifierStore } from '#/shared/testing/in-memory-pkce-verifier-store'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')
const STATE_SECRET = 'ab'.repeat(32)

const setup = () => {
  const pkceStore = createInMemoryPkceVerifierStore()
  const deps = {
    clientId: 'test-client-id',
    callbackUrl: 'http://localhost:3000/api/auth/google/callback',
    stateSecret: STATE_SECRET,
    clock: () => FIXED_TIME,
    idGen: () => 'test-nonce',
    pkceStore,
  }
  return { useCase: getGoogleAuthUrl(deps), pkceStore }
}

describe('getGoogleAuthUrl (BQC-7.6)', () => {
  it('builds an authorization URL with the fixed redirect and scopes', async () => {
    const { useCase } = setup()
    const { url } = await useCase({ visibility: 'private', userId: 'user-1' })
    const parsed = new URL(url)

    expect(parsed.origin + parsed.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    )
    expect(parsed.searchParams.get('client_id')).toBe('test-client-id')
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/auth/google/callback',
    )
    expect(parsed.searchParams.get('response_type')).toBe('code')
    expect(parsed.searchParams.get('access_type')).toBe('offline')
    expect(parsed.searchParams.get('prompt')).toBe('consent')
  })

  it('binds the signed state to the initiating user', async () => {
    const { useCase } = setup()
    const { url } = await useCase({ visibility: 'organization', userId: 'user-1' })
    const state = new URL(url).searchParams.get('state')!

    // Verifies for the initiating user…
    const own = verifyOAuthState(state, {
      secret: STATE_SECRET,
      expectedUserId: 'user-1',
      nowMs: FIXED_TIME.getTime(),
    })
    expect(own.isOk()).toBe(true)
    if (own.isOk()) {
      expect(own.value.visibility).toBe('organization')
      expect(own.value.nonce).toBe('test-nonce')
      expect(own.value.sub).toBe('user-1')
    }

    // …and is rejected for anyone else.
    const other = verifyOAuthState(state, {
      secret: STATE_SECRET,
      expectedUserId: 'user-2',
      nowMs: FIXED_TIME.getTime(),
    })
    expect(other.isErr() && other.error).toBe('user_mismatch')
  })

  it('sends the S256 challenge and stores the verifier under the state nonce', async () => {
    const { useCase, pkceStore } = setup()
    const { url } = await useCase({ visibility: 'private', userId: 'user-1' })
    const parsed = new URL(url)

    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256')
    const challenge = parsed.searchParams.get('code_challenge')
    expect(challenge).toBeTruthy()

    // The verifier was stored under the state nonce with the state TTL…
    const saves = pkceStore.saves()
    expect(saves).toHaveLength(1)
    expect(saves[0].nonce).toBe('test-nonce')
    expect(saves[0].ttlSeconds).toBe(OAUTH_STATE_TTL_SECONDS)

    // …and the URL carries exactly the challenge of the stored verifier.
    const expected = createHash('sha256').update(saves[0].verifier).digest('base64url')
    expect(challenge).toBe(expected)
    // The verifier itself never appears in the URL.
    expect(url).not.toContain(saves[0].verifier)
  })

  it('fails closed when the verifier store is unavailable (no URL issued)', async () => {
    const failing = getGoogleAuthUrl({
      clientId: 'test-client-id',
      callbackUrl: 'http://localhost:3000/api/auth/google/callback',
      stateSecret: STATE_SECRET,
      clock: () => FIXED_TIME,
      idGen: () => 'test-nonce',
      pkceStore: {
        save: async () => {
          throw new Error('redis down')
        },
        redeem: async () => undefined,
      },
    })
    await expect(failing({ visibility: 'private', userId: 'user-1' })).rejects.toThrow(
      'redis down',
    )
  })
})
