import { afterEach, describe, expect, it, vi } from 'vitest'
import { googleConnectionId, organizationId } from '#/shared/domain/ids'
import type { GoogleAuthorizedProviderExecutor } from '../../application/ports/google-authorized-provider-executor.port'
import { createGoogleOAuthAdapter } from './google-oauth.adapter'

const authorization = {
  capability: 'property.import_gbp_v2' as const,
  organizationId: organizationId('organization-oauth'),
  propertyId: null,
  connectionId: googleConnectionId('00000000-0000-4000-8000-000000000101'),
  initiatorUserId: 'user-oauth',
  expectedCredentialGeneration: 1,
  authorizationVector: { credentialGeneration: 1 },
}
const config = {
  clientId: 'client',
  clientSecret: 'secret',
  jwksUrl: 'https://oauth.example.test/jwks',
  clock: () => new Date('2026-11-01T00:00:00Z'),
}
const exchange = {
  contractVersion: 'v2' as const,
  code: 'one-use-code',
  codeVerifier: 'verifier',
  oidcNonce: 'nonce',
  redirectUri: 'https://app.example.test/callback',
  authorization,
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('OAuth through the Google client', () => {
  it.each([
    {
      operation: 'exchange',
      status: 400,
      contentType: 'application/json',
      body: '{"error":"invalid_grant"}',
      code: 'oauth_failed',
      message: 'rejected the request with status 400',
    },
    {
      operation: 'exchange',
      status: 200,
      contentType: 'text/html',
      body: '<html>',
      code: 'oauth_failed',
      message: 'outcome is ambiguous',
    },
    {
      operation: 'refresh',
      status: 200,
      contentType: 'text/html',
      body: '<html>',
      code: 'token_refresh_failed',
      message: 'response was malformed',
    },
    {
      operation: 'refresh',
      status: 200,
      contentType: 'application/json',
      body: '{',
      code: 'token_refresh_failed',
      message: 'response was malformed',
    },
  ] as const)(
    'preserves the $operation refusal for HTTP $status with $contentType and scrubs its body',
    async ({ operation, status, contentType, body: text, code, message }) => {
      const body = new TextEncoder().encode(text)
      const execute = vi.fn<GoogleAuthorizedProviderExecutor['execute']>(async () => ({
        ok: true,
        status,
        headers: { contentType, cacheControl: null, retryAfter: null },
        body,
      }))
      const adapter = createGoogleOAuthAdapter({ ...config, executor: { execute } })
      const outcome =
        operation === 'exchange'
          ? adapter.exchangeCode(exchange)
          : adapter.refreshAccessToken('refresh', authorization)

      await expect(outcome).rejects.toMatchObject({
        code,
        message: expect.stringContaining(message),
      })
      expect(body.every((byte) => byte === 0)).toBe(true)
      expect(execute).toHaveBeenCalledOnce()
    },
  )

  it.each([null, 'application/json; charset=utf-8', 'application/token+json'])(
    'parses a successful refresh with content type %s and scrubs its body',
    async (contentType) => {
      const body = new TextEncoder().encode(
        JSON.stringify({ access_token: 'access', expires_in: 3600 }),
      )
      const execute = vi.fn<GoogleAuthorizedProviderExecutor['execute']>(async () => ({
        ok: true,
        status: 200,
        headers: { contentType, cacheControl: null, retryAfter: null },
        body,
      }))
      const adapter = createGoogleOAuthAdapter({ ...config, executor: { execute } })

      await expect(adapter.refreshAccessToken('refresh', authorization)).resolves.toEqual(
        { accessToken: 'access', expiresIn: 3600 },
      )
      expect(body.every((byte) => byte === 0)).toBe(true)
      expect(execute).toHaveBeenCalledOnce()
    },
  )

  it.each([
    ['malformed_request', 'not_sent', 'confirmed_not_sent'],
    ['admission_denied', 'not_sent', 'confirmed_not_sent'],
    ['deadline_exceeded', 'not_sent', 'confirmed_not_sent'],
    ['admission_denied', 'answered', 'cleanup_ambiguous'],
    ['transport_error', 'unknown', 'cleanup_ambiguous'],
  ] as const)(
    'classifies revoke %s with %s evidence as %s without resending',
    async (code, dispatch, expected) => {
      const execute = vi.fn<GoogleAuthorizedProviderExecutor['execute']>(async () => ({
        ok: false,
        code,
        dispatch,
        retryAfterMs: 0,
      }))
      const adapter = createGoogleOAuthAdapter({ ...config, executor: { execute } })

      await expect(
        adapter.revokeTokenWithOutcome!('refresh', authorization),
      ).resolves.toBe(expected)
      expect(execute).toHaveBeenCalledOnce()
    },
  )

  it.each([
    [204, 'confirmed_revoked'],
    [503, 'cleanup_ambiguous'],
  ] as const)(
    'classifies revoke HTTP %s as %s and scrubs its body',
    async (status, expected) => {
      const body = new TextEncoder().encode('provider response')
      const execute = vi.fn<GoogleAuthorizedProviderExecutor['execute']>(async () => ({
        ok: true,
        status,
        headers: { contentType: null, cacheControl: null, retryAfter: null },
        body,
      }))
      const adapter = createGoogleOAuthAdapter({ ...config, executor: { execute } })

      await expect(
        adapter.revokeTokenWithOutcome!('refresh', authorization),
      ).resolves.toBe(expected)
      expect(body.every((byte) => byte === 0)).toBe(true)
      expect(execute).toHaveBeenCalledOnce()
    },
  )

  it('refuses every credential operation without an executor before opening a socket', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)
    const adapter = createGoogleOAuthAdapter(config)

    await expect(adapter.exchangeCode(exchange)).rejects.toMatchObject({
      code: 'oauth_failed',
    })
    await expect(
      adapter.refreshAccessToken('refresh', authorization),
    ).rejects.toMatchObject({
      code: 'token_refresh_failed',
    })
    await expect(adapter.revokeTokenWithOutcome!('refresh', authorization)).resolves.toBe(
      'confirmed_not_sent',
    )
    await expect(adapter.revokeToken('refresh', authorization)).rejects.toMatchObject({
      code: 'oauth_failed',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('bounds an unanswered one-use exchange and scrubs a late response without retrying', async () => {
    vi.useFakeTimers()
    let complete!: (
      result: Awaited<ReturnType<GoogleAuthorizedProviderExecutor['execute']>>,
    ) => void
    const execute = vi.fn<GoogleAuthorizedProviderExecutor['execute']>(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    const adapter = createGoogleOAuthAdapter({ ...config, executor: { execute } })
    const outcome = expect(adapter.exchangeCode(exchange)).rejects.toThrow(
      'outcome is ambiguous',
    )

    await vi.advanceTimersByTimeAsync(10_000)
    await outcome
    const body = new TextEncoder().encode('late credential response')
    complete({
      ok: true,
      status: 200,
      headers: { contentType: 'application/json', cacheControl: null, retryAfter: null },
      body,
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(body.every((byte) => byte === 0)).toBe(true)
    expect(execute).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0]![1]).toMatchObject({
      authorization,
      deadlineMs: config.clock().getTime() + 10_000,
      signal: expect.any(AbortSignal),
    })
    expect(execute.mock.calls[0]![1].signal?.aborted).toBe(true)
  })
})
