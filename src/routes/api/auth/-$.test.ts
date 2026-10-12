// Review §5.1 — the auth catch-all's brute-force limiter must be ON unless the
// E2E hatch is BOTH exact and authorized.
//
// Why this file exists: nothing in CI would otherwise demand a test for a
// route file, and this seam carries two postures that must not regress — the
// HTTP-boundary allow list and the brute-force limiter. The limiter decision
// was once reached through bare truthiness on an env var that was not in the
// zod schema, and the boundary was once a list of refused paths that the
// provider's surface outgrew.
//
// Invariants proven here:
//   1. E2E unset → every allowed POST is checked against the shared limiter,
//      and a denied check returns 429 without reaching better-auth.
//   2. A near-miss E2E value ('true') does NOT stand the limiter down.
//   3. E2E=1 without a test/CI execution identity does NOT stand the limiter
//      down, and the refusal is logged once per process.
//   4. E2E=1 WITH an execution identity does stand it down — the posture the
//      Playwright stack depends on (compose.local.yml web service).
//   5. Only a request whose method and exact path are on the allow list
//      (./-provider-routes.ts) reaches better-auth. Everything else returns
//      404 before the limiter: the provider's organization reads and writes,
//      self-service /sign-up/email (the beta onboards by invitation only),
//      /send-verification-email (whose per-address limit only the app-owned
//      resend enforces), and any path that names no provider route.
//
// What the refused provider routes do when they are reachable is proven
// against the real provider in ./-$.integration.test.ts.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** The better-auth release the provider route lists were read against. */
const VERIFIED_BETTER_AUTH_VERSION = '1.7.5'

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  handler: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  env: {} as Record<string, unknown>,
}))

vi.mock('#/shared/config/env', () => ({ getEnv: () => mocks.env }))
vi.mock('#/composition', () => ({
  getContainer: () => ({ rateLimiter: { check: mocks.check } }),
}))
vi.mock('#/shared/auth/auth', () => ({ getAuth: () => ({ handler: mocks.handler }) }))
vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({ warn: mocks.warn, error: mocks.error }),
}))

const IDENTITY = 'local-playwright-e2e'

/** The env the route sees, plus the raw process.env a truthiness read would see. */
function useEnv(overrides: Record<string, unknown>) {
  mocks.env = {
    NODE_ENV: 'production',
    TRUSTED_PROXY_MODE: 'railway-edge',
    TRUSTED_PROXY_COUNT: 1,
    TRUSTED_PROXY_MAX_HOPS: 8,
    ...overrides,
  }
  if (typeof overrides.E2E === 'string') process.env.E2E = overrides.E2E
  else delete process.env.E2E
}

// Dynamic import (not static): the route holds process-scoped state — the
// once-per-process refusal log — so each case needs a fresh module instance.
async function loadRoute() {
  vi.resetModules()
  return await import('./$')
}

function signInPost() {
  return new Request('http://localhost:3000/api/auth/sign-in/email', {
    method: 'POST',
    headers: {
      'x-real-ip': '203.0.113.5',
      'x-railway-edge': 'ams1',
      'x-railway-request-id': 'request-1',
    },
  })
}

describe('auth catch-all rate limiting (review §5.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.check.mockResolvedValue({ allowed: true })
    mocks.handler.mockResolvedValue(new Response('ok', { status: 200 }))
  })

  afterEach(() => {
    delete process.env.E2E
  })

  it('limits POSTs when E2E is unset (the default posture)', async () => {
    useEnv({})
    const { handleAuthRequest } = await loadRoute()

    const allowed = await handleAuthRequest(signInPost(), { rateLimit: true })

    expect(mocks.check).toHaveBeenCalledWith('auth:native:203.0.113.5')
    expect(allowed.status).toBe(200)

    mocks.check.mockResolvedValue({ allowed: false })
    const denied = await handleAuthRequest(signInPost(), { rateLimit: true })

    expect(denied.status).toBe(429)
    expect(await denied.json()).toEqual({
      message: 'Too many requests. Please try again later.',
    })
    // The refused request never reaches better-auth.
    expect(mocks.handler).toHaveBeenCalledTimes(1)
  })

  it('keeps the limiter on for a near-miss E2E value, even with an identity', async () => {
    useEnv({ E2E: 'true', BETA_E2E_EXECUTION_IDENTITY: IDENTITY })
    mocks.check.mockResolvedValue({ allowed: false })
    const { handleAuthRequest } = await loadRoute()

    const response = await handleAuthRequest(signInPost(), { rateLimit: true })

    expect(mocks.check).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(429)
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  it('keeps the limiter on for E2E=1 without an execution identity, logging once', async () => {
    useEnv({ E2E: '1' })
    mocks.check.mockResolvedValue({ allowed: false })
    const { handleAuthRequest } = await loadRoute()

    const first = await handleAuthRequest(signInPost(), { rateLimit: true })
    const second = await handleAuthRequest(signInPost(), { rateLimit: true })

    expect(first.status).toBe(429)
    expect(second.status).toBe(429)
    expect(mocks.check).toHaveBeenCalledTimes(2)
    expect(mocks.error).toHaveBeenCalledTimes(1)
    expect(mocks.error.mock.calls[0]?.[1]).toMatch(/auth\.rate_limit_bypass_refused/)
  })

  it('stands the limiter down for E2E=1 with an execution identity (the e2e stack)', async () => {
    useEnv({ E2E: '1', BETA_E2E_EXECUTION_IDENTITY: IDENTITY })
    const { handleAuthRequest } = await loadRoute()

    const response = await handleAuthRequest(signInPost(), { rateLimit: true })

    expect(mocks.check).not.toHaveBeenCalled()
    expect(mocks.error).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
  })
})

describe('auth catch-all allow list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.check.mockResolvedValue({ allowed: true })
    mocks.handler.mockResolvedValue(new Response('ok', { status: 200 }))
    useEnv({})
  })

  it('refuses self-service sign-up with 404 and never reaches better-auth', async () => {
    const { handleAuthRequest } = await loadRoute()

    const response = await handleAuthRequest(
      new Request('http://localhost:3000/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'probe@example.invalid',
          password: 'probe-password-123',
          name: 'Probe',
        }),
      }),
      { rateLimit: true },
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ message: 'Not found' })
    // Refused at the boundary: no user row can be written, and the refusal is
    // decided before the limiter so it cannot be masked by a 429.
    expect(mocks.handler).not.toHaveBeenCalled()
    expect(mocks.check).not.toHaveBeenCalled()
    expect(mocks.warn).toHaveBeenCalledWith(
      { method: 'POST', route: '/sign-up/email' },
      expect.stringMatching(/^auth\.raw_endpoint_blocked:/),
    )
  })

  it('refuses raw organization writes and leaves sign-in reachable', async () => {
    const { handleAuthRequest } = await loadRoute()

    const invite = await handleAuthRequest(
      new Request('http://localhost:3000/api/auth/organization/invite-member', {
        method: 'POST',
      }),
      { rateLimit: true },
    )
    const signIn = await handleAuthRequest(signInPost(), { rateLimit: true })

    expect(invite.status).toBe(404)
    expect(signIn.status).toBe(200)
    expect(mocks.handler).toHaveBeenCalledTimes(1)
  })

  // The per-address limit on resending a verification link (ADR 0062 §6) lives
  // in the app-owned resendVerificationEmail, which calls Better Auth
  // in-process. The raw route has only the per-IP limits, so it would let
  // anyone mail any unverified address over and over.
  it('refuses the raw verification-email send and leaves the mailed link reachable', async () => {
    const { handleAuthRequest } = await loadRoute()

    const send = await handleAuthRequest(
      new Request('http://localhost:3000/api/auth/send-verification-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'unverified@example.invalid' }),
      }),
      { rateLimit: true },
    )
    const verify = await handleAuthRequest(
      new Request('http://localhost:3000/api/auth/verify-email?token=tok-1'),
      { rateLimit: false },
    )

    expect(send.status).toBe(404)
    expect(mocks.check).not.toHaveBeenCalled()
    expect(mocks.warn).toHaveBeenCalledWith(
      { method: 'POST', route: '/send-verification-email' },
      expect.stringMatching(/^auth\.raw_endpoint_blocked:/),
    )
    expect(verify.status).toBe(200)
    expect(mocks.handler).toHaveBeenCalledTimes(1)
  })

  // The provider answers the first two reads for any member of the
  // Organization with every invitation row, ids included, and an invitation id
  // is all that invited registration asks for besides the invited address.
  it.each([
    ['GET', '/organization/list-invitations?organizationId=org-1'],
    ['GET', '/organization/get-full-organization?organizationId=org-1'],
    ['GET', '/organization/get-invitation?id=inv-1'],
    ['GET', '/organization/list-members'],
  ])('refuses the provider read %s %s to a signed-in member', async (method, path) => {
    const { handleAuthRequest } = await loadRoute()

    const response = await handleAuthRequest(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method,
        headers: { cookie: 'better-auth.session_token=member-session' },
      }),
      { rateLimit: false },
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ message: 'Not found' })
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  // The app gates both writes: organization.create is beta_disabled, and
  // organization.update asks the execution policy and validates the name, slug
  // and contact address. The provider's own routes do neither.
  it.each([
    ['/organization/create', { name: 'Mine', slug: 'mine-2026' }],
    ['/organization/update', { data: { name: 'x', contactEmail: 'not-an-email' } }],
  ])('refuses the provider write POST %s', async (path, body) => {
    const { handleAuthRequest } = await loadRoute()

    const response = await handleAuthRequest(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: 'better-auth.session_token=member-session',
        },
        body: JSON.stringify(body),
      }),
      { rateLimit: true },
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ message: 'Not found' })
    expect(mocks.handler).not.toHaveBeenCalled()
    // Decided before the limiter, like every other refusal.
    expect(mocks.check).not.toHaveBeenCalled()
  })

  // Each route the product needs over HTTP still reaches the provider, with
  // the request it was given. The table is written out here, not read from the
  // allow list, so dropping or renaming an entry fails a named case.
  it.each([
    ['GET', '/get-session'],
    ['POST', '/sign-in/email'],
    ['POST', '/sign-out'],
    ['POST', '/request-password-reset'],
    ['GET', '/reset-password/reset-token-1?callbackURL=%2Freset-password'],
    ['POST', '/reset-password'],
    ['GET', '/verify-email?token=tok-1&callbackURL=%2Flogin'],
  ])('hands the allowed route %s %s to the provider', async (method, path) => {
    const { handleAuthRequest } = await loadRoute()
    const request = new Request(`http://localhost:3000/api/auth${path}`, { method })

    const response = await handleAuthRequest(request, { rateLimit: method === 'POST' })

    expect(response.status).toBe(200)
    expect(mocks.handler).toHaveBeenCalledTimes(1)
    expect(mocks.handler.mock.calls[0]?.[0]).toBe(request)
    expect(mocks.warn).not.toHaveBeenCalled()
    // Invariant 1 for every allowed POST, not only sign-in; a GET is not limited.
    expect(mocks.check).toHaveBeenCalledTimes(method === 'POST' ? 1 : 0)
  })

  // Method and exact path, never a suffix, a prefix or a near miss. The old
  // refusal matched with endsWith; an allow list matched that way would serve
  // `/organization/get-session` and anything else that ends in an allowed path.
  // HEAD is here because the framework hands a HEAD request to the GET handler
  // (start-server-core createStartHandler), so one does arrive: a mail
  // gateway probing a mailed link, for example. The provider has no HEAD
  // route, and a GET entry does not allow one.
  it.each([
    ['POST', '/get-session', '/get-session'],
    ['GET', '/sign-in/email', '/sign-in/email'],
    ['GET', '/sign-out', '/sign-out'],
    ['POST', '/verify-email', '/verify-email'],
    ['HEAD', '/get-session', '/get-session'],
    ['HEAD', '/verify-email', '/verify-email'],
    ['HEAD', '/reset-password/reset-token-1', '/reset-password/:token'],
    ['GET', '/get-session/', 'unlisted'],
    ['GET', '/GET-SESSION', 'unlisted'],
    ['GET', '//get-session', 'unlisted'],
    ['GET', '/organization/get-session', 'unlisted'],
    ['GET', '/get-session/organization/list-invitations', 'unlisted'],
    ['GET', '/reset-password/', 'unlisted'],
    ['GET', '/reset-password/token-1/extra', 'unlisted'],
    ['GET', '/not-a-provider-route', 'unlisted'],
  ])('refuses %s %s, which is not an allowed route', async (method, path, route) => {
    const { handleAuthRequest } = await loadRoute()

    const response = await handleAuthRequest(
      new Request(`http://localhost:3000/api/auth${path}`, { method }),
      { rateLimit: method === 'POST' },
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ message: 'Not found' })
    expect(mocks.handler).not.toHaveBeenCalled()
    expect(mocks.check).not.toHaveBeenCalled()
    expect(mocks.warn).toHaveBeenCalledWith(
      { method, route },
      expect.stringMatching(/^auth\.raw_endpoint_blocked:/),
    )
  })

  // A reset link's token is a credential in the path. A refusal names the
  // route as its pattern, so the token never reaches the log.
  it('logs a refused reset-link request without its token', async () => {
    const { handleAuthRequest } = await loadRoute()

    const response = await handleAuthRequest(
      new Request('http://localhost:3000/api/auth/reset-password/secret-reset-token', {
        method: 'POST',
      }),
      { rateLimit: true },
    )

    expect(response.status).toBe(404)
    expect(mocks.warn).toHaveBeenCalledWith(
      { method: 'POST', route: '/reset-password/:token' },
      expect.stringMatching(/^auth\.raw_endpoint_blocked:/),
    )
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain('secret-reset-token')
  })

  // Tripwire, not plumbing: both provider route lists name better-auth's OWN
  // routes. The drift guard in ./-provider-routes.test.ts catches a route that
  // was added, renamed or removed; it cannot see an allowed route that kept
  // its path and changed what it returns or writes. The dependency is
  // therefore pinned exactly, and this fails on any move: when it does,
  // re-read each allowed route's handler (dist/api/routes/session.mjs,
  // sign-in.mjs, sign-out.mjs, password.mjs, email-verification.mjs) against
  // the reason written beside it, then move VERIFIED_BETTER_AUTH_VERSION.
  it('pins the better-auth version the provider route lists were read against', () => {
    const root = resolve(import.meta.dirname, '../../../..')
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    const installed = JSON.parse(
      readFileSync(resolve(root, 'node_modules/better-auth/package.json'), 'utf8'),
    ) as { version: string }

    expect(manifest.dependencies['better-auth']).toBe(VERIFIED_BETTER_AUTH_VERSION)
    expect(installed.version).toBe(VERIFIED_BETTER_AUTH_VERSION)
  })
})
