// Integration context — connect Google account use case tests

import { describe, expect, it } from 'vitest'
import { connectGoogleAccount } from './connect-google-account'
import { createInMemoryGoogleConnectionRepo } from '#/shared/testing/in-memory-google-connection-repo'
import { createSequentialIntegrationCommandStore } from '#/shared/testing/sequential-integration-command-store'
import { createInMemoryGoogleOAuthPort } from '#/shared/testing/in-memory-google-oauth-port'
import { createInMemoryTokenEncryption } from '#/shared/testing/in-memory-token-encryption'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import {
  buildTestAuthContext,
  buildTestGoogleConnection,
} from '#/shared/testing/fixtures'
import { isIntegrationError } from '../../domain/errors'
import { organizationId } from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')
const VERIFIER = 'test-code-verifier'
const OIDC_NONCE = 'test-oidc-nonce'
const input = (visibility: 'private' | 'organization' = 'private') => ({
  code: 'valid-auth-code',
  visibility,
  purpose: 'reviews' as const,
  connectionMode: 'new' as const,
  targetConnectionId: null,
  verifierMaterial: {
    contractVersion: 'v2' as const,
    codeVerifier: VERIFIER,
    oidcNonce: OIDC_NONCE,
  },
})

const setup = () => {
  const connectionRepo = createInMemoryGoogleConnectionRepo()
  const oauth = createInMemoryGoogleOAuthPort()
  const encryption = createInMemoryTokenEncryption()
  const events = createCapturingEventBus()
  const useCase = connectGoogleAccount({
    connectionRepo,
    oauth,
    encryption,
    commandStore: createSequentialIntegrationCommandStore({ connectionRepo, events }),
    clock: () => FIXED_TIME,
    idGen: () => 'test-connection-id',
    callbackUrl: 'http://localhost:3000/api/auth/google/callback',
  })
  return { useCase, connectionRepo, oauth, events }
}

describe('connectGoogleAccount', () => {
  it('creates an OIDC connection and records the v2 lifecycle fact', async () => {
    const { useCase, connectionRepo, events, oauth } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const result = await useCase(input(), ctx)

    expect(connectionRepo.all()).toHaveLength(1)
    expect(result.googleSubject).toBe('google-subject-123')
    expect(result.status).toBe('active')
    expect(result.organizationId).toBe(ctx.organizationId)
    expect(oauth.exchangeVerifierCalls()).toEqual([VERIFIER])
    const emitted = events.capturedByTag('integration.google_account.connected')
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ connectionId: result.id })
  })

  it('rejects users without integration.manage permission before OAuth exchange', async () => {
    const { useCase, oauth } = setup()
    await expect(
      useCase(input(), buildTestAuthContext({ role: 'Staff' })),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) && (error as { code: string }).code === 'forbidden',
    )
    expect(oauth.exchangeVerifierCalls()).toEqual([])
  })

  it('propagates an OAuth exchange failure', async () => {
    const { useCase, oauth } = setup()
    oauth.setExchangeError(new Error('OAuth provider unreachable'))
    await expect(
      useCase(input(), buildTestAuthContext({ role: 'AccountAdmin' })),
    ).rejects.toThrow('OAuth provider unreachable')
  })

  it('reconnects only the exact targeted subject in the same organization', async () => {
    const { useCase, connectionRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const existing = buildTestGoogleConnection({
      googleSubject: 'google-subject-123',
      status: 'disconnected',
      visibility: 'private',
    })
    connectionRepo.seed([existing])

    const result = await useCase(
      {
        ...input('organization'),
        connectionMode: 'reconnect',
        targetConnectionId: existing.id,
      },
      ctx,
    )

    expect(result).toMatchObject({
      id: existing.id,
      googleSubject: 'google-subject-123',
      status: 'active',
      visibility: 'organization',
      scopes: ['openid', 'https://www.googleapis.com/auth/business.manage'],
    })
    expect(connectionRepo.all()).toHaveLength(1)
    expect(events.capturedByTag('integration.google_account.connected')[0]).toMatchObject(
      {
        connectionId: existing.id,
      },
    )
  })
  it('does not let a new ceremony adopt an existing same-organization subject', async () => {
    const { useCase, connectionRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const existing = buildTestGoogleConnection({
      googleSubject: 'google-subject-123',
      status: 'disconnected',
    })
    connectionRepo.seed([existing])

    await expect(useCase(input('organization'), ctx)).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) &&
        (error as { code: string }).code === 'account_already_connected',
    )
    expect(connectionRepo.all()).toEqual([existing])
    expect(events.capturedByTag('integration.google_account.connected')).toEqual([])
  })

  it('rejects a targeted ceremony when the returned subject belongs to another row', async () => {
    const { useCase, connectionRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const target = buildTestGoogleConnection({
      id: '00000000-0000-4000-8000-000000000111',
      googleSubject: 'different-subject',
      status: 'disconnected',
    })
    const mapped = buildTestGoogleConnection({
      id: '00000000-0000-4000-8000-000000000222',
      googleSubject: 'google-subject-123',
    })
    connectionRepo.seed([target, mapped])

    await expect(
      useCase(
        {
          ...input(),
          connectionMode: 'reauth',
          targetConnectionId: target.id,
        },
        ctx,
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) &&
        (error as { code: string }).code === 'account_already_connected',
    )
    expect(connectionRepo.all()).toEqual([target, mapped])
    expect(events.capturedByTag('integration.google_account.connected')).toEqual([])
  })

  it('rejects a signed subject already claimed by another organization', async () => {
    const { useCase, connectionRepo } = setup()
    connectionRepo.seed([
      buildTestGoogleConnection({
        googleSubject: 'google-subject-123',
        organizationId: organizationId('org-other'),
      }),
    ])

    await expect(
      useCase(input(), buildTestAuthContext({ role: 'AccountAdmin' })),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) &&
        (error as { code: string }).code === 'account_already_connected',
    )
    expect(connectionRepo.all()).toHaveLength(1)
  })

  it('derives token expiry and preserves requested visibility', async () => {
    const { useCase, connectionRepo, oauth } = setup()
    oauth.setExchangeResult({
      identity: { kind: 'oidc', googleSubject: 'google-subject-123' },
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      expiresIn: 7200,
      scopes: ['https://www.googleapis.com/auth/business.manage'],
    })

    await useCase(input('organization'), buildTestAuthContext({ role: 'AccountAdmin' }))

    expect(connectionRepo.all()[0]).toMatchObject({
      tokenExpiresAt: new Date('2026-04-10T14:00:00Z'),
      visibility: 'organization',
    })
  })
})
