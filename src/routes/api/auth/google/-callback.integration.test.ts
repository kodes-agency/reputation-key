import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleGoogleOAuthCallback } from './callback'
import { organizationId } from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createGoogleConnectionCeremonyFixture } from '#/contexts/integration/connections/google-connection-ceremony.test-fixtures'
import {
  buildTestAuthContext,
  buildTestGoogleConnection,
} from '#/shared/testing/fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'

// The callback route over the real connect ceremony and PostgreSQL. Session and
// state admission are mocked; the route's own mocks live in -callback.test.ts.
const mocks = vi.hoisted(() => ({
  getSessionFromHeaders: vi.fn(),
  resolveTenantContext: vi.fn(),
  admitPreState: vi.fn(),
  admitTenant: vi.fn(),
  redeemState: vi.fn(),
  connectGoogleAccount: vi.fn(),
  resumeGoogleAccountConnection: vi.fn(),
}))

vi.mock('#/shared/config/env', async (importOriginal) => {
  const original = await importOriginal<typeof import('#/shared/config/env')>()
  return {
    ...original,
    getEnv: () => ({ ...original.getEnv(), BETTER_AUTH_URL: 'https://app.example.test' }),
  }
})
vi.mock('#/shared/auth/middleware', () => ({
  getSessionFromHeaders: mocks.getSessionFromHeaders,
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({
    integrationPublicApi: {
      oauth: {
        admitPreState: mocks.admitPreState,
        admitResolvedTenant: mocks.admitTenant,
        redeemState: mocks.redeemState,
      },
      connections: {
        connect: mocks.connectGoogleAccount,
        resume: mocks.resumeGoogleAccountConnection,
      },
    },
  }),
}))

setupIntegrationDb({
  orgA: organizationId('org-00000000-0000-0000-0000-000000000001'),
  orgB: organizationId('org-connect-gc-other'),
  tables: ['google_connections', 'outbox_events'],
})

beforeAll(registerAllEventSchemas)
afterAll(clearEventSchemas)

const redeemed = {
  ok: true as const,
  kind: 'exchange' as const,
  exchangeAttemptId: '60000000-0000-4000-8000-000000000001',
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

describe('GET /api/auth/google/callback with the real ceremony', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSessionFromHeaders.mockResolvedValue({
      session: { id: 'session-1' },
      user: { id: 'user-1' },
    })
    mocks.admitPreState.mockResolvedValue({ ok: true })
    mocks.admitTenant.mockResolvedValue({ ok: true })
  })

  it.each(['reconnect', 'reauth'] as const)(
    'returns success for %s without waiting for category discovery, including completed replay',
    async (connectionMode) => {
      const refresh = vi.fn(async () => {
        throw new Error('category provider unavailable')
      })
      const fixture = await createGoogleConnectionCeremonyFixture(undefined, refresh)
      const actor = buildTestAuthContext({ role: 'AccountAdmin' })
      const target = buildTestGoogleConnection({
        organizationId: actor.organizationId,
        googleSubject: 'google-subject-123',
        status: connectionMode === 'reauth' ? 'reauth_required' : 'disconnected',
      })
      await fixture.connectionRepo.seed([target])
      mocks.resolveTenantContext.mockResolvedValue(actor)
      mocks.redeemState.mockResolvedValue({
        ...redeemed,
        connectionMode,
        targetConnectionId: target.id,
      })
      mocks.connectGoogleAccount.mockImplementation(fixture.useCase)
      mocks.resumeGoogleAccountConnection.mockImplementation(fixture.useCase.resume)

      const response = await handleGoogleOAuthCallback(
        request('state=v2.v2.secret.handle&code=provider-secret'),
      )
      expect(response.headers.get('location')).toBe(
        `https://app.example.test/properties/import-google?connectionId=${target.id}`,
      )
      expect((await fixture.connectionRepo.all())[0]?.status).toBe('active')
      expect(refresh).not.toHaveBeenCalled()
      mocks.redeemState.mockResolvedValue({
        ok: true,
        kind: 'recovery',
        exchangeAttemptId: redeemed.exchangeAttemptId,
        returnRoute: redeemed.returnRoute,
      })
      const replay = await handleGoogleOAuthCallback(
        request('state=v2.v2.secret.handle&code=provider-secret'),
      )
      expect(replay.headers.get('location')).toBe(response.headers.get('location'))
      expect(refresh).not.toHaveBeenCalled()
      expect(fixture.exchangeCode).toHaveBeenCalledTimes(1)
      expect(
        await fixture.outbox.byTag('integration.google_account.connected'),
      ).toHaveLength(1)
    },
  )
})
