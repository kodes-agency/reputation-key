import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleGoogleOAuthCallback } from './callback'

// This hoisted mock bundle and the trace/logger/env/composition vi.mock chain
// under it match the opening of src/routes/api/webhooks/resend/-events.test.ts.
// They cannot be shared: the Vitest transform hoists vi.hoisted and vi.mock
// above this file's imports and the module registry is per test file, so a
// helper that called them would run too late to mock what the route imports.
// Revisit if setupFiles ever carries the trace/logger/env trio for every route
// test; the per-route composition mock would still have to live here.
// fallow-ignore-next-line code-duplication
const mocks = vi.hoisted(() => ({
  getSessionFromHeaders: vi.fn(),
  resolveTenantContext: vi.fn(),
  admitPreState: vi.fn(),
  admitTenant: vi.fn(),
  redeemState: vi.fn(),
  connectGoogleAccount: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('#/shared/observability/trace', () => ({
  trace: (_name: string, fn: () => Promise<unknown>) => fn(),
}))
vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({ warn: mocks.warn, error: mocks.error }),
}))
vi.mock('#/shared/config/env', () => ({
  getEnv: () => ({ BETTER_AUTH_URL: 'https://app.example.test' }),
}))
vi.mock('#/shared/auth/middleware', () => ({
  getSessionFromHeaders: mocks.getSessionFromHeaders,
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({
    useCases: {
      admitGoogleOAuthCallbackPreState: mocks.admitPreState,
      admitGoogleOAuthCallbackTenant: mocks.admitTenant,
      redeemGoogleOAuthState: mocks.redeemState,
      connectGoogleAccount: mocks.connectGoogleAccount,
    },
  }),
}))

const redeemed = {
  ok: true as const,
  visibility: 'private' as const,
  purpose: 'import_gbp_v2' as const,
  connectionMode: 'new' as const,
  targetConnectionId: null,
  returnRoute: '/properties/import-google' as const,
  verifierMaterial: {
    contractVersion: 'v2' as const,
    codeVerifier: 'v'.repeat(43),
    oidcNonce: 'n'.repeat(43),
  },
}

const request = (query: string) =>
  new Request(`https://app.example.test/api/auth/google/callback?${query}`, {
    headers: { cookie: 'better-auth.session_token=session-secret' },
  })

describe('GET /api/auth/google/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSessionFromHeaders.mockResolvedValue({
      session: { id: 'session-1' },
      user: { id: 'user-1' },
    })
    mocks.resolveTenantContext.mockResolvedValue({
      organizationId: 'org-1',
      userId: 'user-1',
    })
    mocks.admitPreState.mockResolvedValue({ ok: true })
    mocks.admitTenant.mockResolvedValue({ ok: true })
    mocks.redeemState.mockResolvedValue(redeemed)
    mocks.connectGoogleAccount.mockResolvedValue({ id: 'connection-1' })
  })

  it('admits before inspecting state and returns one indistinguishable failure', async () => {
    mocks.admitPreState.mockResolvedValue({
      ok: false,
      code: 'pre_state_quota_exhausted',
    })

    const response = await handleGoogleOAuthCallback(
      request('state=v2.v2.secret.handle&code=provider-secret'),
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'https://app.example.test/properties/import-google?error=connection_failed',
    )
    expect(mocks.resolveTenantContext).not.toHaveBeenCalled()
    expect(mocks.redeemState).not.toHaveBeenCalled()
    expect(mocks.connectGoogleAccount).not.toHaveBeenCalled()
  })

  it('does not consume state when the session binding cannot be resolved', async () => {
    mocks.getSessionFromHeaders.mockResolvedValue(null)
    mocks.resolveTenantContext.mockRejectedValue(new Error('session expired'))

    const response = await handleGoogleOAuthCallback(
      request('state=v2.v2.secret.handle&code=provider-secret'),
    )

    expect(response.headers.get('location')).toBe(
      'https://app.example.test/properties/import-google?error=connection_failed',
    )
    expect(mocks.redeemState).not.toHaveBeenCalled()
    expect(mocks.connectGoogleAccount).not.toHaveBeenCalled()
  })

  it('consumes a valid state before honoring a provider denial and makes no exchange', async () => {
    const response = await handleGoogleOAuthCallback(
      request('state=v2.v2.secret.handle&error=access_denied'),
    )

    expect(mocks.redeemState).toHaveBeenCalledWith({
      handle: 'v2.v2.secret.handle',
      organizationId: 'org-1',
      userId: 'user-1',
      sessionId: 'session-1',
      nowMs: expect.any(Number),
    })
    expect(mocks.admitTenant).toHaveBeenCalledAfter(mocks.redeemState)
    expect(mocks.connectGoogleAccount).not.toHaveBeenCalled()
    // A declined consent screen is the user's own choice, not a broken connection.
    expect(response.headers.get('location')).toBe(
      'https://app.example.test/properties/import-google?error=denied',
    )
  })

  it.each([
    ['state=v2.v2.secret.handle&error=server_error'],
    ['state=v2.v2.secret.handle&error=invalid_scope'],
    ['state=v2.v2.secret.handle'],
  ])('reports a non-denial callback failure as a failure: %s', async (query) => {
    const response = await handleGoogleOAuthCallback(request(query))

    expect(mocks.connectGoogleAccount).not.toHaveBeenCalled()
    expect(response.headers.get('location')).toBe(
      'https://app.example.test/properties/import-google?error=connection_failed',
    )
  })

  it('uses only redeemed server facts and redirects to the frozen route', async () => {
    const response = await handleGoogleOAuthCallback(
      request(
        'state=v2.v2.secret.handle&code=provider-secret&visibility=organization&returnRoute=https://evil.test',
      ),
    )

    expect(mocks.connectGoogleAccount).toHaveBeenCalledWith(
      {
        code: 'provider-secret',
        visibility: 'private',
        purpose: 'import_gbp_v2',
        connectionMode: 'new',
        targetConnectionId: null,
        verifierMaterial: redeemed.verifierMaterial,
      },
      { organizationId: 'org-1', userId: 'user-1' },
    )
    expect(response.headers.get('location')).toBe(
      'https://app.example.test/properties/import-google?connectionId=connection-1',
    )
  })
})
