// Review §5.1 — the auth catch-all's brute-force limiter must be ON unless the
// E2E hatch is BOTH exact and authorized.
//
// Why this file exists: `src/routes/**` is excluded from the changed-code test
// budget (scripts/check-changed-code.mjs), so nothing in CI would have demanded
// a test for this file. It was the only rate-limit decision in the codebase
// with no colocated proof, and it was reached through bare truthiness on an env
// var that was not in the zod schema.
//
// Invariants proven here:
//   1. E2E unset → every POST is checked against the shared limiter, and a
//      denied check returns 429 without reaching better-auth.
//   2. A near-miss E2E value ('true') does NOT stand the limiter down.
//   3. E2E=1 without a test/CI execution identity does NOT stand the limiter
//      down, and the refusal is logged once per process.
//   4. E2E=1 WITH an execution identity does stand it down — the posture the
//      Playwright stack depends on (compose.local.yml web service).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  mocks.env = { NODE_ENV: 'production', TRUSTED_PROXY_COUNT: 1, ...overrides }
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
    headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
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
