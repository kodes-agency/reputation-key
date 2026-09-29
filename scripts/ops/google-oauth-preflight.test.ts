import { describe, expect, it, vi } from 'vitest'
import type { CommandRunner } from './deploy-ci-images'
import {
  checkGoogleOAuth,
  decodeGoogleAuthError,
  formatGoogleOAuthReport,
  readGoogleOAuthConfig,
  type GoogleOAuthConfig,
} from './google-oauth-preflight'

const CONFIG: GoogleOAuthConfig = {
  baseUrl: 'https://web-closed-beta-v2.up.railway.app',
  clientId: '223390342009-abc.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-never-printed',
}
const CALLBACK = 'https://web-closed-beta-v2.up.railway.app/api/auth/google/callback'

// Captured 2026-09-29 from Google for a callback missing on the client.
const MISMATCH_AUTH_ERROR =
  'ChVyZWRpcmVjdF91cmlfbWlzbWF0Y2gSsAEKWW91IGNhbid0IHNpZ24gaW4gdG8gdGhpcyBhcHAgYmVjYXVzZSBpdCBkb2Vzbid0IGNvbXBseSB3aXRoIEdvb2dsZSdzIE9BdXRoIDIuMCBwb2xpY3ku'
const errorPage = (authError: string) =>
  `https://accounts.google.com/signin/oauth/error?authError=${authError}&client_id=x`
const redirect = (location: string) =>
  new Response(null, { status: 302, headers: { location } })
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>
function googleStub(authorize: Route, token: Route) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    if (url.startsWith('https://accounts.google.com/o/oauth2/v2/auth')) {
      return authorize(url, init)
    }
    if (url === 'https://oauth2.googleapis.com/token') return token(url, init)
    throw new Error(`unexpected request ${url}`)
  })
}
const acceptedToken: Route = () =>
  json(400, { error: 'invalid_grant', error_description: 'Malformed auth code.' })
const signIn: Route = () =>
  redirect('https://accounts.google.com/v3/signin/identifier?continue=x')

describe('decodeGoogleAuthError', () => {
  it('reads the error code out of the error page location', () => {
    expect(decodeGoogleAuthError(errorPage(MISMATCH_AUTH_ERROR))).toBe(
      'redirect_uri_mismatch',
    )
  })

  it('finds nothing on a sign-in location', () => {
    expect(
      decodeGoogleAuthError('https://accounts.google.com/v3/signin/identifier'),
    ).toBe(null)
  })
})

describe('checkGoogleOAuth', () => {
  it('passes when Google continues to sign-in and knows the secret', async () => {
    const report = await checkGoogleOAuth(CONFIG, googleStub(signIn, acceptedToken))

    expect(report.ok).toBe(true)
    expect(report.checks.map(({ name, verdict }) => [name, verdict])).toEqual([
      ['redirect_uri', 'accepted'],
      ['client_secret', 'accepted'],
    ])
  })

  it('fails when Google refuses the callback address', async () => {
    const report = await checkGoogleOAuth(
      CONFIG,
      googleStub(() => redirect(errorPage(MISMATCH_AUTH_ERROR)), acceptedToken),
    )

    expect(report.ok).toBe(false)
    expect(report.checks[0]).toMatchObject({
      name: 'redirect_uri',
      verdict: 'rejected',
      error: 'redirect_uri_mismatch',
    })
  })

  it('also reads a mismatch Google renders directly', async () => {
    const report = await checkGoogleOAuth(
      CONFIG,
      googleStub(
        () => new Response('<p>Error 400: redirect_uri_mismatch</p>', { status: 400 }),
        acceptedToken,
      ),
    )

    expect(report.checks[0]).toMatchObject({
      verdict: 'rejected',
      error: 'redirect_uri_mismatch',
    })
  })

  // The probe is only worth anything if Google judges the request users send.
  it('sends Google the same authorize request the app sends', async () => {
    const fetchStub = googleStub(signIn, acceptedToken)
    await checkGoogleOAuth(CONFIG, fetchStub)

    const sent = new URL(String(fetchStub.mock.calls[0]![0]))
    expect(sent.searchParams.get('client_id')).toBe(CONFIG.clientId)
    expect(sent.searchParams.get('redirect_uri')).toBe(CALLBACK)
    expect(sent.searchParams.get('scope')).toBe(
      'openid email https://www.googleapis.com/auth/business.manage',
    )
    expect(sent.searchParams.get('code_challenge_method')).toBe('S256')
    expect(fetchStub.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' })
  })

  it('fails when Google no longer accepts the client secret', async () => {
    const report = await checkGoogleOAuth(
      CONFIG,
      googleStub(signIn, () =>
        json(401, {
          error: 'invalid_client',
          error_description: 'The provided client secret is invalid.',
        }),
      ),
    )

    expect(report.ok).toBe(false)
    expect(report.checks[1]).toMatchObject({
      name: 'client_secret',
      verdict: 'rejected',
      error: 'invalid_client',
    })
  })

  it('sends the secret only in the token request body', async () => {
    const fetchStub = googleStub(signIn, acceptedToken)
    await checkGoogleOAuth(CONFIG, fetchStub)

    const [authorizeUrl] = fetchStub.mock.calls[0]!
    const [tokenUrl, tokenInit] = fetchStub.mock.calls[1]!
    expect(String(authorizeUrl)).not.toContain(CONFIG.clientSecret)
    expect(String(tokenUrl)).not.toContain(CONFIG.clientSecret)
    expect(String(tokenInit?.body)).toContain(CONFIG.clientSecret)
  })

  it('fails closed when Google cannot be reached', async () => {
    const report = await checkGoogleOAuth(
      CONFIG,
      vi.fn<typeof fetch>().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')),
    )

    expect(report.ok).toBe(false)
    expect(report.checks.map(({ verdict }) => verdict)).toEqual(['unknown', 'unknown'])
  })

  it('fails closed on an answer it does not recognise', async () => {
    const report = await checkGoogleOAuth(
      CONFIG,
      googleStub(
        () => new Response('maintenance', { status: 503 }),
        () => json(500, {}),
      ),
    )

    expect(report.ok).toBe(false)
    expect(report.checks.map(({ verdict }) => verdict)).toEqual(['unknown', 'unknown'])
  })
})

describe('formatGoogleOAuthReport', () => {
  it('names the exact address to register and where, never the secret', async () => {
    const report = await checkGoogleOAuth(
      CONFIG,
      googleStub(() => redirect(errorPage(MISMATCH_AUTH_ERROR)), acceptedToken),
    )
    const text = formatGoogleOAuthReport(report).join('\n')

    expect(text).toContain(CALLBACK)
    expect(text).toContain(
      'https://console.cloud.google.com/auth/clients/223390342009-abc.apps.googleusercontent.com?project=223390342009',
    )
    expect(text).not.toContain(CONFIG.clientSecret)
  })

  it('reports a pass in one line per check', async () => {
    const report = await checkGoogleOAuth(CONFIG, googleStub(signIn, acceptedToken))

    expect(formatGoogleOAuthReport(report)).toEqual([
      `Google OAuth: ok — Google accepts ${CALLBACK} for client ${CONFIG.clientId}`,
      'Google OAuth: ok — Google accepts the client secret',
    ])
  })
})

describe('readGoogleOAuthConfig', () => {
  const runnerWith =
    (stdout: string): CommandRunner =>
    () => ({ status: 0, stdout, stderr: '' })

  it('reads the three values the connect flow uses from the web service', () => {
    const calls: string[][] = []
    const runner: CommandRunner = (command, args) => {
      calls.push([command, ...args])
      return runnerWith(
        [
          'BETTER_AUTH_URL=https://web-closed-beta-v2.up.railway.app',
          `GOOGLE_CLIENT_ID=${CONFIG.clientId}`,
          `GOOGLE_CLIENT_SECRET=${CONFIG.clientSecret}`,
          'OTHER=x=y',
        ].join('\n'),
      )(command, args)
    }

    expect(readGoogleOAuthConfig(runner, ['--service', 'web-id'])).toEqual(CONFIG)
    expect(calls).toEqual([
      ['railway', 'variable', 'list', '--service', 'web-id', '--kv'],
    ])
  })

  it('names a missing variable without echoing the others', () => {
    expect(() =>
      readGoogleOAuthConfig(
        runnerWith(`GOOGLE_CLIENT_SECRET=${CONFIG.clientSecret}\n`),
        [],
      ),
    ).toThrow(/BETTER_AUTH_URL, GOOGLE_CLIENT_ID/)
    expect(() =>
      readGoogleOAuthConfig(
        runnerWith(`GOOGLE_CLIENT_SECRET=${CONFIG.clientSecret}\n`),
        [],
      ),
    ).not.toThrow(new RegExp(CONFIG.clientSecret))
  })
})
