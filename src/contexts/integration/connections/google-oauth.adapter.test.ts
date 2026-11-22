import { describe, expect, it, vi } from 'vitest'
import { createGoogleOAuthAdapter } from './google-oauth.adapter.server'
import type { GoogleAuthorizedProviderExecutor } from '../provider/google-client.port.server'
import {
  BUSINESS_MANAGE_SCOPE,
  CONFIG,
  EMAIL_SCOPE,
  authorization,
  executorAdapter,
  executorAnswering,
  executorFailing,
  executorResult,
  exchangeInput,
  jsonResponse,
  signedIdToken,
  stubFetch,
  tokenEndpointResponse,
} from '#/shared/testing/google-oauth-adapter.test-fixtures'

describe('createGoogleOAuthAdapter', () => {
  const fetchMock = stubFetch()

  it('verifies the v2 ID token and returns only the signed subject identity', async () => {
    const { token, jwks } = await signedIdToken('oidc-nonce')
    fetchMock
      .mockResolvedValueOnce(tokenEndpointResponse({ id_token: token }))
      .mockResolvedValueOnce(jsonResponse(jwks))

    const result = await createGoogleOAuthAdapter(CONFIG).exchangeCode(exchangeInput())

    expect(result.identity).toEqual({
      kind: 'oidc',
      googleSubject: 'signed-google-subject',
      email: null,
    })
    expect(result.scopes).toEqual([BUSINESS_MANAGE_SCOPE, 'openid'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const tokenRequest = fetchMock.mock.calls[0]!
    expect(tokenRequest[0]).toBe(CONFIG.tokenUrl)
    expect(tokenRequest[1]).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(await new Response(tokenRequest[1]?.body).text()).toContain(
      'code_verifier=pkce-verifier',
    )
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ redirect: 'error' })
  })

  it('persists the successful exchange before JWKS work and resumes without re-exchange', async () => {
    const { token, jwks } = await signedIdToken('oidc-nonce')
    fetchMock
      .mockResolvedValueOnce(tokenEndpointResponse({ id_token: token }))
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
        ...exchangeInput({ code: 'one-use-code' }),
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

  it('reads the verified email of a grant with the email scope as a label, not an identity', async () => {
    const exchange = async (
      scope: string,
      claims: Readonly<{ email?: string; emailVerified?: boolean | string }>,
    ) => {
      const { token, jwks } = await signedIdToken('oidc-nonce', claims)
      fetchMock
        .mockReset()
        .mockResolvedValueOnce(tokenEndpointResponse({ scope, id_token: token }))
        .mockResolvedValueOnce(jsonResponse(jwks))
      return createGoogleOAuthAdapter(CONFIG).exchangeCode(exchangeInput())
    }

    const granted = await exchange(`openid ${EMAIL_SCOPE} ${BUSINESS_MANAGE_SCOPE}`, {
      email: 'owner@meridian.example',
      emailVerified: true,
    })
    expect(granted.identity).toEqual({
      kind: 'oidc',
      googleSubject: 'signed-google-subject',
      email: 'owner@meridian.example',
    })
    expect(granted.scopes).toEqual([BUSINESS_MANAGE_SCOPE, EMAIL_SCOPE, 'openid'])

    const shortForm = await exchange(`email openid ${BUSINESS_MANAGE_SCOPE}`, {
      email: 'owner@meridian.example',
      emailVerified: 'true',
    })
    expect(shortForm.identity.email).toBe('owner@meridian.example')
    expect(shortForm.scopes).toEqual([BUSINESS_MANAGE_SCOPE, EMAIL_SCOPE, 'openid'])

    const unverified = await exchange(`openid ${EMAIL_SCOPE} ${BUSINESS_MANAGE_SCOPE}`, {
      email: 'owner@meridian.example',
      emailVerified: false,
    })
    expect(unverified.identity.email).toBeNull()

    await expect(
      exchange(`openid ${EMAIL_SCOPE} ${BUSINESS_MANAGE_SCOPE} profile`, {
        email: 'owner@meridian.example',
        emailVerified: true,
      }),
    ).rejects.toMatchObject({ code: 'oauth_failed' })
    await expect(
      exchange(`openid ${EMAIL_SCOPE}`, {
        email: 'owner@meridian.example',
        emailVerified: true,
      }),
    ).rejects.toMatchObject({ code: 'scope_not_granted' })
  })

  it('refuses a grant without Business Profile access with its own code, before preserving it', async () => {
    const preserveSuccessfulResult = vi.fn(async () => undefined)
    const exchange = (body: Record<string, unknown>) => {
      fetchMock.mockReset().mockResolvedValueOnce(
        jsonResponse({
          access_token: 'access-token',
          expires_in: 3600,
          id_token: 'unverified-id-token',
          ...body,
        }),
      )
      return createGoogleOAuthAdapter(CONFIG).exchangeCode({
        ...exchangeInput(),
        preserveSuccessfulResult,
      })
    }

    // Google's granular consent screen with the Business Profile box unticked.
    await expect(
      exchange({ refresh_token: 'refresh-token', scope: `openid ${EMAIL_SCOPE}` }),
    ).rejects.toMatchObject({ code: 'scope_not_granted' })
    // Only the token endpoint was read: no JWKS fetch for a refused grant.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await expect(
      exchange({ refresh_token: 'refresh-token', scope: 'email openid' }),
    ).rejects.toMatchObject({ code: 'scope_not_granted' })
    // The missing permission is reported even when another check would also fail.
    await expect(exchange({ scope: `openid ${EMAIL_SCOPE}` })).rejects.toMatchObject({
      code: 'scope_not_granted',
    })
    // Malformed scope answers stay generic failures.
    await expect(exchange({ refresh_token: 'refresh-token' })).rejects.toMatchObject({
      code: 'oauth_failed',
    })
    await expect(
      exchange({
        refresh_token: 'refresh-token',
        scope: `openid ${EMAIL_SCOPE} ${EMAIL_SCOPE}`,
      }),
    ).rejects.toMatchObject({ code: 'oauth_failed' })

    expect(preserveSuccessfulResult).not.toHaveBeenCalled()
  })

  it('fails closed when the signed nonce or exact granted scopes do not match', async () => {
    const { token, jwks } = await signedIdToken('different-nonce')
    fetchMock
      .mockResolvedValueOnce(tokenEndpointResponse({ id_token: token }))
      .mockResolvedValueOnce(jsonResponse(jwks))

    await expect(
      createGoogleOAuthAdapter(CONFIG).exchangeCode(
        exchangeInput({ oidcNonce: 'expected-nonce' }),
      ),
    ).rejects.toMatchObject({ code: 'oauth_failed' })

    fetchMock
      .mockReset()
      .mockResolvedValueOnce(
        tokenEndpointResponse({ scope: BUSINESS_MANAGE_SCOPE, id_token: token }),
      )
    await expect(
      createGoogleOAuthAdapter(CONFIG).exchangeCode(
        exchangeInput({ oidcNonce: 'different-nonce' }),
      ),
    ).rejects.toMatchObject({ code: 'oauth_failed' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('requires exact issued-at, audience, and authorized-party claims', async () => {
    const missingIat = await signedIdToken('oidc-nonce', {
      includeIssuedAt: false,
    })
    fetchMock
      .mockResolvedValueOnce(tokenEndpointResponse({ id_token: missingIat.token }))
      .mockResolvedValueOnce(jsonResponse(missingIat.jwks))
    const input = exchangeInput()
    await expect(
      createGoogleOAuthAdapter(CONFIG).exchangeCode(input),
    ).rejects.toMatchObject({ code: 'oauth_failed' })

    const wrongAzp = await signedIdToken('oidc-nonce', { azp: 'other-client' })
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(tokenEndpointResponse({ id_token: wrongAzp.token }))
      .mockResolvedValueOnce(jsonResponse(wrongAzp.jwks))
    await expect(
      createGoogleOAuthAdapter(CONFIG).exchangeCode(input),
    ).rejects.toMatchObject({ code: 'oauth_failed' })
  })

  it('bounds the JWKS cache and uses stale keys only on provider failure', async () => {
    const { token, jwks } = await signedIdToken('oidc-nonce')
    let now = new Date()
    const tokenResponse = () => tokenEndpointResponse({ id_token: token })
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse(jwks, { headers: { 'Cache-Control': 'max-age=1' } }),
      )
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
    const adapter = createGoogleOAuthAdapter({ ...CONFIG, clock: () => now })
    const input = exchangeInput()
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
      createGoogleOAuthAdapter(CONFIG).exchangeCode(exchangeInput()),
    ).rejects.toThrow('outcome is ambiguous')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('refuses missing authorization before every token or revoke operation', async () => {
    const execute = vi.fn<GoogleAuthorizedProviderExecutor['execute']>()
    const adapter = createGoogleOAuthAdapter({ ...CONFIG, executor: { execute } })
    const { authorization: _omitted, ...withoutAuthorization } = exchangeInput()

    await expect(adapter.exchangeCode(withoutAuthorization)).rejects.toMatchObject({
      code: 'oauth_failed',
    })
    await expect(adapter.refreshAccessToken('refresh-token')).rejects.toMatchObject({
      code: 'token_refresh_failed',
    })
    await expect(adapter.revokeTokenWithOutcome!('refresh-token')).resolves.toBe(
      'confirmed_not_sent',
    )
    await expect(adapter.revokeToken('refresh-token')).rejects.toMatchObject({
      code: 'oauth_failed',
    })
    expect(execute).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('routes exchange, refresh, and revoke through the authorized executor while keeping JWKS as the sole direct trust read', async () => {
    const { token, jwks } = await signedIdToken('oidc-nonce')
    const execute = vi.fn<GoogleAuthorizedProviderExecutor['execute']>()
    execute
      .mockResolvedValueOnce(
        executorResult(
          200,
          JSON.stringify({
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            expires_in: 3600,
            scope: `openid ${BUSINESS_MANAGE_SCOPE}`,
            id_token: token,
          }),
        ),
      )
      .mockResolvedValueOnce(
        executorResult(
          200,
          JSON.stringify({ access_token: 'refreshed-token', expires_in: 1800 }),
        ),
      )
      .mockResolvedValueOnce(executorResult(200, '', null))
    fetchMock.mockResolvedValueOnce(jsonResponse(jwks))
    const adapter = executorAdapter(execute)

    await expect(adapter.exchangeCode(exchangeInput())).resolves.toMatchObject({
      accessToken: 'access-token',
    })
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
    const execute = executorFailing('transport_error')

    await expect(
      executorAdapter(execute).exchangeCode(exchangeInput({ code: 'single-use-code' })),
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
      const { execute, responseBody } = executorAnswering(status, body, contentType)

      await expect(
        executorAdapter(execute).exchangeCode(exchangeInput({ code: 'single-use-code' })),
      ).rejects.toThrow('outcome is ambiguous')
      expect([...responseBody].every((byte) => byte === 0)).toBe(true)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )
})
