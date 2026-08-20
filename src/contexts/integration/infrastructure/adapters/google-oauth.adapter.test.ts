import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { createGoogleOAuthAdapter } from './google-oauth.adapter'

const BUSINESS_MANAGE_SCOPE = 'https://www.googleapis.com/auth/business.manage'
const CONFIG = {
  clientId: 'rep-key-client',
  clientSecret: 'client-secret',
  tokenUrl: 'https://oauth.example.test/token',
  jwksUrl: 'https://oauth.example.test/jwks',
  revokeUrl: 'https://oauth.example.test/revoke',
}

const jsonResponse = (value: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })

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
})
