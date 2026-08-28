import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { createGoogleOAuthAdapter } from './google-oauth.adapter'
import type { GoogleAuthorizedProviderExecutor } from '../../application/ports/google-authorized-provider-executor.port'
import { googleConnectionId, organizationId } from '#/shared/domain/ids'

const BUSINESS_MANAGE_SCOPE = 'https://www.googleapis.com/auth/business.manage'
const CONFIG = {
  clientId: 'rep-key-client',
  clientSecret: 'client-secret',
  tokenUrl: 'https://oauth.example.test/token',
  jwksUrl: 'https://oauth.example.test/jwks',
  revokeUrl: 'https://oauth.example.test/revoke',
  clock: () => new Date(),
}

const jsonResponse = (value: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })

const authorization = {
  capability: 'property.import_gbp_v2' as const,
  organizationId: organizationId('org-oauth-gateway'),
  propertyId: null,
  connectionId: googleConnectionId('00000000-0000-4000-8000-000000000101'),
  initiatorUserId: 'user-oauth-gateway',
  approvalBindingId: 'approval-oauth-gateway',
  expectedCredentialGeneration: 1,
  authorizationVector: { credentialGeneration: 1 },
}

describe('createGoogleOAuthAdapter', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function signedIdToken(
    nonce: string,
    options: Readonly<{
      azp?: string
      includeIssuedAt?: boolean
      audience?: string | string[]
    }> = {},
  ) {
    const { publicKey, privateKey } = await generateKeyPair('RS256')
    const jwk = await exportJWK(publicKey)
    let builder = new SignJWT({
      nonce,
      ...(options.azp === undefined ? {} : { azp: options.azp }),
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer('https://accounts.google.com')
      .setAudience(options.audience ?? CONFIG.clientId)
      .setSubject('signed-google-subject')
    if (options.includeIssuedAt !== false) builder = builder.setIssuedAt()
    const token = await builder.setExpirationTime('5m').sign(privateKey)
    return { token, jwks: { keys: [{ ...jwk, kid: 'test-key', alg: 'RS256' }] } }
  }

  it('verifies the v2 ID token and returns only the signed subject identity', async () => {
    const { token, jwks } = await signedIdToken('oidc-nonce')
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
          scope: `openid ${BUSINESS_MANAGE_SCOPE}`,
          id_token: token,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(jwks))

    const result = await createGoogleOAuthAdapter(CONFIG).exchangeCode({
      contractVersion: 'v2',
      code: 'authorization-code',
      redirectUri: 'https://app.example.test/api/auth/google/callback',
      codeVerifier: 'pkce-verifier',
      oidcNonce: 'oidc-nonce',
    })

    expect(result.identity).toEqual({
      kind: 'oidc',
      googleSubject: 'signed-google-subject',
    })
    expect(result.scopes).toEqual([BUSINESS_MANAGE_SCOPE, 'openid'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const tokenRequest = fetchMock.mock.calls[0]!
    expect(tokenRequest[0]).toBe(CONFIG.tokenUrl)
    expect(tokenRequest[1]).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(String(tokenRequest[1]?.body)).toContain('code_verifier=pkce-verifier')
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ redirect: 'error' })
  })

  it('persists the successful exchange before JWKS work and resumes without re-exchange', async () => {
    const { token, jwks } = await signedIdToken('oidc-nonce')
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
          scope: `openid ${BUSINESS_MANAGE_SCOPE}`,
          id_token: token,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(jwks))
    const adapter = createGoogleOAuthAdapter(CONFIG)
    let preserved:
      | Parameters<
          NonNullable<
            Parameters<typeof adapter.exchangeCode>[0]['preserveSuccessfulResult']
          >
        >[0]
      | undefined
    const crashAfterPreserve = new Error('simulated crash after durable preserve')

    await expect(
      adapter.exchangeCode({
        contractVersion: 'v2',
        code: 'one-use-code',
        redirectUri: 'https://app.example.test/api/auth/google/callback',
        codeVerifier: 'pkce-verifier',
        oidcNonce: 'oidc-nonce',
        preserveSuccessfulResult: async (result) => {
          preserved = result
          expect(fetchMock).toHaveBeenCalledTimes(1)
          throw crashAfterPreserve
        },
      }),
    ).rejects.toBe(crashAfterPreserve)
    expect(preserved).toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      idToken: token,
    })

    await expect(
      adapter.exchangeCode({
        contractVersion: 'v2',
        code: 'must-not-be-sent',
        redirectUri: 'https://app.example.test/api/auth/google/callback',
        codeVerifier: 'must-not-be-sent',
        oidcNonce: 'oidc-nonce',
        preservedResult: preserved!,
      }),
    ).resolves.toMatchObject({
      identity: { kind: 'oidc', googleSubject: 'signed-google-subject' },
      accessToken: 'access-token',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]![0]).toBe(CONFIG.jwksUrl)
  })

  it('fails closed when the signed nonce or exact granted scopes do not match', async () => {
    const { token, jwks } = await signedIdToken('different-nonce')
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
          scope: `openid ${BUSINESS_MANAGE_SCOPE}`,
          id_token: token,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(jwks))

    await expect(
      createGoogleOAuthAdapter(CONFIG).exchangeCode({
        contractVersion: 'v2',
        code: 'authorization-code',
        redirectUri: 'https://app.example.test/api/auth/google/callback',
        codeVerifier: 'pkce-verifier',
        oidcNonce: 'expected-nonce',
      }),
    ).rejects.toMatchObject({ code: 'oauth_failed' })

    fetchMock.mockReset().mockResolvedValueOnce(
      jsonResponse({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        scope: BUSINESS_MANAGE_SCOPE,
        id_token: token,
      }),
    )
    await expect(
      createGoogleOAuthAdapter(CONFIG).exchangeCode({
        contractVersion: 'v2',
        code: 'authorization-code',
        redirectUri: 'https://app.example.test/api/auth/google/callback',
        codeVerifier: 'pkce-verifier',
        oidcNonce: 'different-nonce',
      }),
    ).rejects.toMatchObject({ code: 'oauth_failed' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('requires exact issued-at, audience, and authorized-party claims', async () => {
    const missingIat = await signedIdToken('oidc-nonce', {
      includeIssuedAt: false,
    })
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
          scope: `openid ${BUSINESS_MANAGE_SCOPE}`,
          id_token: missingIat.token,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(missingIat.jwks))
    const input = {
      contractVersion: 'v2' as const,
      code: 'authorization-code',
      redirectUri: 'https://app.example.test/api/auth/google/callback',
      codeVerifier: 'pkce-verifier',
      oidcNonce: 'oidc-nonce',
    }
    await expect(
      createGoogleOAuthAdapter(CONFIG).exchangeCode(input),
    ).rejects.toMatchObject({ code: 'oauth_failed' })

    const wrongAzp = await signedIdToken('oidc-nonce', { azp: 'other-client' })
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
          scope: `openid ${BUSINESS_MANAGE_SCOPE}`,
          id_token: wrongAzp.token,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(wrongAzp.jwks))
    await expect(
      createGoogleOAuthAdapter(CONFIG).exchangeCode(input),
    ).rejects.toMatchObject({ code: 'oauth_failed' })
  })

  it('bounds the JWKS cache and uses stale keys only on provider failure', async () => {
    const { token, jwks } = await signedIdToken('oidc-nonce')
    let now = new Date()
    const tokenResponse = () =>
      jsonResponse({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        scope: `openid ${BUSINESS_MANAGE_SCOPE}`,
        id_token: token,
      })
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse(jwks, { headers: { 'Cache-Control': 'max-age=1' } }),
      )
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
    const adapter = createGoogleOAuthAdapter({ ...CONFIG, clock: () => now })
    const input = {
      contractVersion: 'v2' as const,
      code: 'authorization-code',
      redirectUri: 'https://app.example.test/api/auth/google/callback',
      codeVerifier: 'pkce-verifier',
      oidcNonce: 'oidc-nonce',
    }
    await expect(adapter.exchangeCode(input)).resolves.toMatchObject({
      identity: { kind: 'oidc', googleSubject: 'signed-google-subject' },
    })
    now = new Date(now.getTime() + 1_100)
    await expect(adapter.exchangeCode(input)).resolves.toMatchObject({
      identity: { kind: 'oidc', googleSubject: 'signed-google-subject' },
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('rejects oversized responses before parsing provider content', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{}', {
        status: 200,
        headers: { 'content-length': String(64 * 1024 + 1) },
      }),
    )

    await expect(
      createGoogleOAuthAdapter(CONFIG).exchangeCode({
        contractVersion: 'v2',
        code: 'authorization-code',
        redirectUri: 'https://app.example.test/api/auth/google/callback',
        codeVerifier: 'pkce-verifier',
        oidcNonce: 'oidc-nonce',
      }),
    ).rejects.toMatchObject({ code: 'oauth_failed' })
  })

  it('checks the credential egress boundary before every token or revoke socket', async () => {
    const refusal = new Error('credential gateway required')
    const assertDirectCredentialEgressAllowed = vi.fn(() => {
      throw refusal
    })
    const adapter = createGoogleOAuthAdapter({
      ...CONFIG,
      assertDirectCredentialEgressAllowed,
    })

    await expect(
      adapter.exchangeCode({
        contractVersion: 'v2',
        code: 'authorization-code',
        redirectUri: 'https://app.example.test/api/auth/google/callback',
        codeVerifier: 'pkce-verifier',
        oidcNonce: 'oidc-nonce',
      }),
    ).rejects.toBe(refusal)
    await expect(adapter.refreshAccessToken('refresh-token')).rejects.toBe(refusal)
    await expect(adapter.revokeToken('refresh-token')).rejects.toBe(refusal)

    expect(assertDirectCredentialEgressAllowed.mock.calls).toEqual([
      ['oauth.token.exchange'],
      ['oauth.token.refresh'],
      ['oauth.revoke'],
    ])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('routes exchange, refresh, and revoke through the authorized executor while keeping JWKS as the sole direct trust read', async () => {
    const { token, jwks } = await signedIdToken('oidc-nonce')
    const execute = vi.fn<GoogleAuthorizedProviderExecutor['execute']>()
    execute
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          contentType: 'application/json',
          cacheControl: null,
          retryAfter: null,
        },
        body: new TextEncoder().encode(
          JSON.stringify({
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            expires_in: 3600,
            scope: `openid ${BUSINESS_MANAGE_SCOPE}`,
            id_token: token,
          }),
        ),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          contentType: 'application/json',
          cacheControl: null,
          retryAfter: null,
        },
        body: new TextEncoder().encode(
          JSON.stringify({ access_token: 'refreshed-token', expires_in: 1800 }),
        ),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { contentType: null, cacheControl: null, retryAfter: null },
        body: new Uint8Array(),
      })
    fetchMock.mockResolvedValueOnce(jsonResponse(jwks))
    const adapter = createGoogleOAuthAdapter({
      ...CONFIG,
      executor: { execute },
      nowMs: () => Date.now(),
    })

    await expect(
      adapter.exchangeCode({
        contractVersion: 'v2',
        code: 'authorization-code',
        redirectUri: 'https://app.example.test/api/auth/google/callback',
        codeVerifier: 'pkce-verifier',
        oidcNonce: 'oidc-nonce',
        authorization,
      }),
    ).resolves.toMatchObject({ accessToken: 'access-token' })
    await expect(
      adapter.refreshAccessToken('refresh-token', authorization),
    ).resolves.toEqual({ accessToken: 'refreshed-token', expiresIn: 1800 })
    await expect(adapter.revokeToken('refresh-token', authorization)).resolves.toBe(
      undefined,
    )

    expect(execute.mock.calls.map(([descriptor]) => descriptor.routeKey)).toEqual([
      'oauth.token.exchange',
      'oauth.token.refresh',
      'oauth.revoke',
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe(CONFIG.jwksUrl)
  })

  it('classifies a lost exchange response as ambiguous and never opens a direct fallback', async () => {
    const execute = vi.fn<GoogleAuthorizedProviderExecutor['execute']>(async () => ({
      ok: false,
      code: 'transport_error',
      retryAfterMs: 0,
    }))
    const adapter = createGoogleOAuthAdapter({
      ...CONFIG,
      executor: { execute },
      nowMs: () => Date.now(),
    })

    await expect(
      adapter.exchangeCode({
        contractVersion: 'v2',
        code: 'single-use-code',
        redirectUri: 'https://app.example.test/api/auth/google/callback',
        codeVerifier: 'pkce-verifier',
        oidcNonce: 'oidc-nonce',
        authorization,
      }),
    ).rejects.toThrow('outcome is ambiguous')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      name: 'provider 5xx',
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'temporarily_unavailable' }),
    },
    {
      name: 'malformed successful JSON',
      status: 200,
      contentType: 'application/json',
      body: '{',
    },
    {
      name: 'invalid successful token contract',
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ access_token: 'unusable-without-expiry' }),
    },
  ])(
    'classifies $name after exchange dispatch as ambiguous and zeroizes response bytes',
    async ({ status, contentType, body }) => {
      const responseBody = new TextEncoder().encode(body)
      const execute = vi.fn<GoogleAuthorizedProviderExecutor['execute']>(async () => ({
        ok: true,
        status,
        headers: { contentType, cacheControl: null, retryAfter: null },
        body: responseBody,
      }))
      const adapter = createGoogleOAuthAdapter({
        ...CONFIG,
        executor: { execute },
        nowMs: () => Date.now(),
      })

      await expect(
        adapter.exchangeCode({
          contractVersion: 'v2',
          code: 'single-use-code',
          redirectUri: 'https://app.example.test/api/auth/google/callback',
          codeVerifier: 'pkce-verifier',
          oidcNonce: 'oidc-nonce',
          authorization,
        }),
      ).rejects.toThrow('outcome is ambiguous')
      expect([...responseBody].every((byte) => byte === 0)).toBe(true)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )
})
