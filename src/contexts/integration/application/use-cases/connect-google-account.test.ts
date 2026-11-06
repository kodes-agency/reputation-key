import { describe, expect, it, vi } from 'vitest'
import { createGoogleConnectionCeremonyFixture as setup } from '#/shared/testing/google-connection-ceremony-fixture'
import {
  buildTestAuthContext,
  buildTestGoogleConnection,
} from '#/shared/testing/fixtures'
import { integrationError, isIntegrationError } from '../../domain/errors'
import { organizationId } from '#/shared/domain/ids'
import type { GoogleOAuthProviderCallAuthorizer } from '../ports/google-oauth.port'

const VERIFIER = 'test-code-verifier'
const OIDC_NONCE = 'test-oidc-nonce'
const input = (visibility: 'private' | 'organization' = 'private') => ({
  exchangeAttemptId: '60000000-0000-4000-8000-000000000001',
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

describe('connectGoogleAccount', () => {
  it('creates an OIDC connection and records the v2 lifecycle fact', async () => {
    const { useCase, connectionRepo, outbox, oauth } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const result = await useCase(input(), ctx)

    expect(connectionRepo.all()).toHaveLength(1)
    expect(result.googleSubject).toBe('google-subject-123')
    expect(result.googleAccountEmail).toBe('owner@example.com')
    expect(result.status).toBe('active')
    expect(result.organizationId).toBe(ctx.organizationId)
    expect(oauth.exchangeVerifierCalls()).toEqual([VERIFIER])
    const facts = outbox.byTag('integration.google_account.connected')
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ connectionId: result.id })
  })

  it('returns the exact committed connection on callback replay without re-exchange', async () => {
    const { useCase, exchangeCode, markAttemptCompleted } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const connected = await useCase(input(), ctx)
    markAttemptCompleted()
    const replayed = await useCase.resume({ attemptId: input().exchangeAttemptId }, ctx)

    expect(replayed).toEqual(connected)
    expect(exchangeCode).toHaveBeenCalledTimes(1)
  })

  it('authorizes the exact prospective connection before exchanging a one-use code', async () => {
    const authorizeProviderCall = vi.fn<GoogleOAuthProviderCallAuthorizer>(
      async (request) => ({
        capability: 'property.import_gbp_v2',
        organizationId: request.organizationId,
        propertyId: null,
        connectionId: request.connectionId,
        initiatorUserId: request.initiatorUserId,
        expectedCredentialGeneration: 0,
        authorizationVector: {
          oauthCredentialOperation: 'exchange_new',
          credentialGeneration: 0,
        },
      }),
    )
    const { useCase } = setup(authorizeProviderCall)
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const result = await useCase(input(), ctx)

    expect(authorizeProviderCall).toHaveBeenCalledWith({
      operation: 'oauth.token.exchange',
      organizationId: ctx.organizationId,
      connectionId: result.id,
      initiatorUserId: ctx.userId,
    })
  })

  it('rejects users without integration.manage permission before OAuth exchange', async () => {
    const { useCase, oauth } = setup()
    await expect(
      useCase(input(), buildTestAuthContext({ role: 'Member' })),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) && (error as { code: string }).code === 'forbidden',
    )
    expect(oauth.exchangeVerifierCalls()).toEqual([])
  })

  it('propagates an OAuth exchange failure and closes the attempt as ambiguous', async () => {
    const { useCase, oauth, finishWithoutResult } = setup()
    oauth.setExchangeError(new Error('OAuth provider unreachable'))
    await expect(
      useCase(input(), buildTestAuthContext({ role: 'AccountAdmin' })),
    ).rejects.toThrow('OAuth provider unreachable')
    expect(finishWithoutResult).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        id: input().exchangeAttemptId,
        outcome: 'provider_outcome_ambiguous',
        outcomeCode: 'exchange_result_not_preserved',
      }),
    )
  })

  it('closes a grant without Business Profile access as failed, not ambiguous', async () => {
    const { useCase, oauth, connectionRepo, finishWithoutResult } = setup()
    oauth.setExchangeError(
      integrationError('scope_not_granted', 'Business Profile access missing'),
    )

    await expect(
      useCase(input(), buildTestAuthContext({ role: 'AccountAdmin' })),
    ).rejects.toMatchObject({ code: 'scope_not_granted' })

    expect(finishWithoutResult).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        id: input().exchangeAttemptId,
        outcome: 'failed',
        outcomeCode: 'scope_not_granted',
      }),
    )
    expect(connectionRepo.all()).toEqual([])
  })

  it('reconnects only the exact targeted subject in the same organization', async () => {
    const { useCase, connectionRepo, outbox } = setup()
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
      googleAccountEmail: 'owner@example.com',
      status: 'active',
      visibility: 'organization',
      scopes: ['openid', 'https://www.googleapis.com/auth/business.manage'],
    })
    expect(connectionRepo.all()).toHaveLength(1)
    expect(outbox.byTag('integration.google_account.connected')[0]).toMatchObject({
      connectionId: existing.id,
    })
  })

  it('leaves category refresh to the committed fact on reconnect and completed callback retry', async () => {
    const refresh = vi.fn(async () => {})
    const { useCase, connectionRepo, markAttemptCompleted, exchangeCode } = setup(
      undefined,
      refresh,
    )
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const existing = buildTestGoogleConnection({
      status: 'disconnected',
      googleSubject: null,
    })
    connectionRepo.seed([existing])

    const connected = await useCase(
      {
        ...input(),
        connectionMode: 'reconnect',
        targetConnectionId: existing.id,
      },
      ctx,
    )
    expect(refresh).not.toHaveBeenCalled()
    markAttemptCompleted()
    refresh.mockRejectedValueOnce(new Error('category read unavailable'))
    await expect(
      useCase.resume({ attemptId: input().exchangeAttemptId }, ctx),
    ).resolves.toEqual(connected)
    await useCase.resume({ attemptId: input().exchangeAttemptId }, ctx)
    expect(refresh).not.toHaveBeenCalled()
    expect(exchangeCode).toHaveBeenCalledTimes(1)
  })

  it('refuses a reconnect that loses the race to a disconnect and keeps it disconnected', async () => {
    const { useCase, connectionRepo, outbox } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const target = buildTestGoogleConnection({
      googleSubject: 'google-subject-123',
      status: 'reauth_required',
    })
    connectionRepo.seed([target])
    const findSubject = connectionRepo.findByGoogleIdentityGlobal
    // Another AccountAdmin disconnects the connection after this ceremony has
    // re-proved its target and before it commits.
    ;(
      connectionRepo as { findByGoogleIdentityGlobal: typeof findSubject }
    ).findByGoogleIdentityGlobal = async (identity) => {
      await connectionRepo.updateStatus(ctx.organizationId, target.id, 'disconnected')
      await connectionRepo.redactForDisconnect(ctx.organizationId, target.id)
      return findSubject(identity)
    }

    await expect(
      useCase(
        {
          ...input('organization'),
          connectionMode: 'reauth',
          targetConnectionId: target.id,
        },
        ctx,
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) && (error as { code: string }).code === 'oauth_failed',
    )
    await expect(
      connectionRepo.findById(ctx.organizationId, target.id),
    ).resolves.toMatchObject({
      status: 'disconnected',
      googleSubject: null,
      encryptedRefreshToken: 'redacted',
    })
    expect(outbox.byTag('integration.google_account.connected')).toEqual([])
  })

  it('does not let a new ceremony adopt an existing same-organization subject', async () => {
    const { useCase, connectionRepo, outbox } = setup()
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
    expect(outbox.byTag('integration.google_account.connected')).toEqual([])
  })

  it('rejects a targeted ceremony when the returned subject belongs to another row', async () => {
    const { useCase, connectionRepo, outbox } = setup()
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
    expect(outbox.byTag('integration.google_account.connected')).toEqual([])
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

  it('derives token expiry and normalizes legacy visibility to Organization ownership', async () => {
    const { useCase, connectionRepo, oauth } = setup()
    oauth.setExchangeResult({
      identity: { kind: 'oidc', googleSubject: 'google-subject-123', email: null },
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      expiresIn: 7200,
      scopes: ['https://www.googleapis.com/auth/business.manage'],
    })

    await useCase(input('private'), buildTestAuthContext({ role: 'AccountAdmin' }))

    expect(connectionRepo.all()[0]).toMatchObject({
      tokenExpiresAt: new Date('2026-04-10T14:00:00Z'),
      visibility: 'organization',
    })
  })

  it('does not let a PropertyManager connect even with forged legacy permissions', async () => {
    const { useCase, oauth } = setup()
    const manager = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(useCase(input(), manager)).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) && (error as { code: string }).code === 'forbidden',
    )
    expect(oauth.exchangeVerifierCalls()).toEqual([])
  })
})
