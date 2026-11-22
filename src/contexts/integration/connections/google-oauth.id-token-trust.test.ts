import { describe, expect, it, vi } from 'vitest'
import { createGoogleOAuthAdapter } from './google-oauth.adapter.server'
import {
  CONFIG,
  exchangeInput,
  jsonResponse,
  signingKey,
  stubFetch,
  tokenEndpointResponse,
} from '#/shared/testing/google-oauth-adapter.test-fixtures'

describe('Google ID token age and JWKS key cache', () => {
  const fetchMock = stubFetch()
  const NOW = new Date('2030-06-01T12:00:00.000Z')
  const NOW_SECONDS = NOW.getTime() / 1_000
  const MINUTE_MS = 60_000
  const input = exchangeInput()

  const requestUrl = (request: Parameters<typeof fetch>[0]) =>
    typeof request === 'string'
      ? request
      : request instanceof URL
        ? request.href
        : request.url

  const serveGoogle = (
    token: () => Promise<string>,
    jwksResponse: () => Response | Promise<Response>,
  ) => {
    const jwksFetches = vi.fn()
    fetchMock.mockImplementation(async (request) => {
      if (requestUrl(request) === CONFIG.jwksUrl) {
        jwksFetches()
        return jwksResponse()
      }
      return tokenEndpointResponse({ id_token: await token() })
    })
    return jwksFetches
  }

  describe('ID token age', () => {
    const exchangeWithAge = async (ageSeconds: number) => {
      const { sign, jwks } = await signingKey()
      serveGoogle(
        () => sign({ issuedAtSeconds: NOW_SECONDS - ageSeconds }),
        () => jsonResponse(jwks),
      )
      return createGoogleOAuthAdapter({ ...CONFIG, clock: () => NOW }).exchangeCode(input)
    }

    const ageRows = [
      { name: 'accepts a token issued exactly ten minutes ago', ageSeconds: 600 },
      {
        name: 'refuses a token issued one second over ten minutes ago, though it has not expired',
        ageSeconds: 601,
      },
      { name: 'refuses a token issued long ago', ageSeconds: 3_000 },
    ]

    for (const { name, ageSeconds } of ageRows) {
      it(name, async () => {
        const exchange = expect(exchangeWithAge(ageSeconds))
        if (ageSeconds <= 600) {
          await exchange.resolves.toMatchObject({
            identity: { kind: 'oidc', googleSubject: 'signed-google-subject' },
          })
        } else {
          await exchange.rejects.toMatchObject({ code: 'oauth_failed' })
        }
      })
    }
  })

  describe('key cache deadline', () => {
    let now: Date
    const advance = (ms: number) => {
      now = new Date(now.getTime() + ms)
    }

    const setup = async (cacheControl: string | undefined) => {
      now = NOW
      const { sign, jwks } = await signingKey()
      let jwksOutcome: () => Response = () =>
        jsonResponse(
          jwks,
          cacheControl === undefined
            ? {}
            : { headers: { 'Cache-Control': cacheControl } },
        )
      // Issued at the adapter's current time, so the age limit never interferes.
      const jwksFetches = serveGoogle(
        () => sign({ issuedAtSeconds: Math.floor(now.getTime() / 1_000) }),
        () => jwksOutcome(),
      )
      const adapter = createGoogleOAuthAdapter({ ...CONFIG, clock: () => now })
      return {
        adapter,
        jwksFetches,
        failKeys: () => {
          jwksOutcome = () => new Response(null, { status: 503 })
        },
      }
    }

    const keyCacheRows = [
      {
        name: 'reads the keys again only after the default five minutes when no max-age is sent',
        cacheControl: undefined,
        ttlMs: 5 * MINUTE_MS,
      },
      {
        name: 'falls back to the five-minute default for Cache-Control "max-age=0"',
        cacheControl: 'max-age=0',
        ttlMs: 5 * MINUTE_MS,
      },
      {
        name: 'falls back to the five-minute default for Cache-Control "max-age=abc"',
        cacheControl: 'max-age=abc',
        ttlMs: 5 * MINUTE_MS,
      },
      {
        name: 'falls back to the five-minute default for Cache-Control "public"',
        cacheControl: 'public',
        ttlMs: 5 * MINUTE_MS,
      },
      {
        name: 'honours a max-age between the floor and the ceiling to the millisecond',
        cacheControl: 'public, max-age=1800',
        ttlMs: 30 * MINUTE_MS,
      },
      {
        name: 'caps a long max-age at one hour',
        cacheControl: 'max-age=86400',
        ttlMs: 60 * MINUTE_MS,
      },
    ]

    for (const { name, cacheControl, ttlMs } of keyCacheRows) {
      it(name, async () => {
        const { adapter, jwksFetches } = await setup(cacheControl)

        await adapter.exchangeCode(input)
        advance(ttlMs - 1)
        await adapter.exchangeCode(input)
        expect(jwksFetches).toHaveBeenCalledTimes(1)

        advance(1)
        await adapter.exchangeCode(input)
        expect(jwksFetches).toHaveBeenCalledTimes(2)
      })
    }

    it('serves expired keys through a provider failure until ten minutes past the deadline', async () => {
      const { adapter, jwksFetches, failKeys } = await setup('max-age=60')
      await adapter.exchangeCode(input)
      failKeys()

      advance(60_000 + 10 * MINUTE_MS - 1)
      await expect(adapter.exchangeCode(input)).resolves.toMatchObject({
        identity: { googleSubject: 'signed-google-subject' },
      })
      expect(jwksFetches).toHaveBeenCalledTimes(2)
    })

    it('refuses the exchange once a failing provider outlasts the stale window', async () => {
      const { adapter, failKeys } = await setup('max-age=60')
      await adapter.exchangeCode(input)
      failKeys()

      advance(60_000 + 10 * MINUTE_MS)
      await expect(adapter.exchangeCode(input)).rejects.toMatchObject({
        code: 'oauth_failed',
      })
    })

    it('serves expired keys when the keys cannot be reached at all', async () => {
      const { adapter, jwksFetches } = await setup('max-age=60')
      await adapter.exchangeCode(input)
      const respond = fetchMock.getMockImplementation()!
      fetchMock.mockImplementation(async (request, init) => {
        if (requestUrl(request) === CONFIG.jwksUrl) throw new TypeError('network down')
        return respond(request, init)
      })

      advance(2 * MINUTE_MS)
      await expect(adapter.exchangeCode(input)).resolves.toMatchObject({
        identity: { googleSubject: 'signed-google-subject' },
      })
      expect(jwksFetches).toHaveBeenCalledTimes(1)
    })
  })
})
