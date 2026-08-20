// Integration context — opaque Google authorization URL contract.

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { getGoogleAuthUrl } from './get-google-auth-url'
import { createOAuthStateHandleService } from '../oauth-state-handle'
import { createInMemoryProviderEphemeralStore } from '#/shared/provider-ephemeral/in-memory-store'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')
const HANDLE_KEYS = `v1:${'11'.repeat(32)}`
const SESSION_KEYS = `v1:${'22'.repeat(32)}`

const createStateHandles = () =>
  createOAuthStateHandleService({
    store: createInMemoryProviderEphemeralStore(),
    handleKeys: createVersionedHmacKeyring(HANDLE_KEYS),
    sessionKeys: createVersionedHmacKeyring(SESSION_KEYS),
    random: () => Buffer.alloc(32, 5),
  })

const setup = () => {
  const stateHandles = createStateHandles()
  const useCase = getGoogleAuthUrl({
    clientId: 'test-client-id',
    callbackUrl: 'http://localhost:3000/api/auth/google/callback',
    clock: () => FIXED_TIME,
    stateHandles,
  })
  return { useCase, stateHandles }
}

const request = {
  visibility: 'organization' as const,
  userId: 'user-1',
  organizationId: 'org-1',
  sessionId: 'session-1',
  purpose: 'import_gbp_v2' as const,
  connectionMode: 'new' as const,
  targetConnectionId: null,
}

describe('getGoogleAuthUrl', () => {
  it('builds the exact Google OIDC and GBP authorization request', async () => {
    const { useCase } = setup()
    const parsed = new URL((await useCase(request)).url)

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
    expect(parsed.searchParams.get('scope')).toBe(
      'openid https://www.googleapis.com/auth/business.manage',
    )
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256')
    expect(parsed.searchParams.get('nonce')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(parsed.searchParams.get('state')).toMatch(
      /^v2\.v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/,
    )
  })

  it('keeps tenant, user, session, PKCE verifier, and OIDC nonce behind the handle', async () => {
    const { useCase, stateHandles } = setup()
    const { url } = await useCase(request)
    const parsed = new URL(url)
    const state = parsed.searchParams.get('state')!

    expect(state).not.toContain(request.organizationId)
    expect(state).not.toContain(request.userId)
    const redeemed = await stateHandles.redeem({
      handle: state,
      organizationId: request.organizationId,
      userId: request.userId,
      sessionId: request.sessionId,
      nowMs: FIXED_TIME.getTime(),
    })
    expect(redeemed).toMatchObject({
      ok: true,
      visibility: 'organization',
      purpose: 'import_gbp_v2',
      connectionMode: 'new',
      targetConnectionId: null,
      verifierMaterial: { contractVersion: 'v2' },
    })
    if (!redeemed.ok) throw new Error('expected opaque OAuth state redemption')
    const expectedChallenge = createHash('sha256')
      .update(redeemed.verifierMaterial.codeVerifier)
      .digest('base64url')
    expect(parsed.searchParams.get('code_challenge')).toBe(expectedChallenge)
    expect(parsed.searchParams.get('nonce')).toBe(redeemed.verifierMaterial.oidcNonce)
    expect(url).not.toContain(redeemed.verifierMaterial.codeVerifier)
  })

  it('fails before issuing a URL when required tenant or session binding is absent', async () => {
    const { useCase } = setup()
    await expect(useCase({ visibility: 'private', userId: 'user-1' })).rejects.toThrow(
      'Opaque OAuth state dependencies are unavailable',
    )
  })

  it('fails closed when the provider-ephemeral store is unavailable', async () => {
    const stateHandles = createOAuthStateHandleService({
      store: {
        ...createInMemoryProviderEphemeralStore(),
        putIfAbsent: async () => {
          throw new Error('provider store unavailable')
        },
      },
      handleKeys: createVersionedHmacKeyring(HANDLE_KEYS),
      sessionKeys: createVersionedHmacKeyring(SESSION_KEYS),
    })
    const useCase = getGoogleAuthUrl({
      clientId: 'test-client-id',
      callbackUrl: 'http://localhost:3000/api/auth/google/callback',
      clock: () => FIXED_TIME,
      stateHandles,
    })

    await expect(useCase(request)).rejects.toThrow('provider store unavailable')
  })
})
