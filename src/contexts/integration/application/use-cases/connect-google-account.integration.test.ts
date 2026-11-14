import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { createGoogleConnectionCeremonyFixture as setup } from '#/contexts/integration/connections/google-connection-ceremony.test-fixtures'
import {
  buildTestAuthContext,
  buildTestGoogleConnection,
} from '#/shared/testing/fixtures'
import { integrationError, isIntegrationError } from '../../domain/errors'
import { organizationId } from '#/shared/domain/ids'
import type { GoogleOAuthProviderCallAuthorizer } from '../ports/google-oauth.port'

const OTHER_ORG = organizationId('org-connect-gc-other')

setupIntegrationDb({
  orgA: organizationId('org-00000000-0000-0000-0000-000000000001'),
  orgB: OTHER_ORG,
  tables: ['google_connections', 'outbox_events'],
})

beforeAll(registerAllEventSchemas)
afterAll(clearEventSchemas)

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
    const { useCase, connectionRepo, outbox, oauth } = await setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const result = await useCase(input(), ctx)

    expect(await connectionRepo.all()).toHaveLength(1)
    expect(result.googleSubject).toBe('google-subject-123')
    expect(result.googleAccountEmail).toBe('owner@example.com')
    expect(result.status).toBe('active')
    expect(result.organizationId).toBe(ctx.organizationId)
    expect(oauth.exchangeVerifierCalls()).toEqual([VERIFIER])
    const facts = await outbox.byTag('integration.google_account.connected')
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ connectionId: result.id })
  })

  it('returns the exact committed connection on callback replay without re-exchange', async () => {
    const { useCase, exchangeCode } = await setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const connected = await useCase(input(), ctx)
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
    const { useCase } = await setup(authorizeProviderCall)
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
    const { useCase, oauth } = await setup()
    await expect(
      useCase(input(), buildTestAuthContext({ role: 'Member' })),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) && (error as { code: string }).code === 'forbidden',
    )
    expect(oauth.exchangeVerifierCalls()).toEqual([])
  })

  it('propagates an OAuth exchange failure and closes the attempt as ambiguous', async () => {
    const { useCase, oauth, finishWithoutResult } = await setup()
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
    const { useCase, oauth, connectionRepo, finishWithoutResult } = await setup()
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
    expect(await connectionRepo.all()).toEqual([])
  })

  it('reconnects only the exact targeted subject in the same organization', async () => {
    const { useCase, connectionRepo, outbox } = await setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const existing = buildTestGoogleConnection({
      googleSubject: 'google-subject-123',
      status: 'disconnected',
    })
    await connectionRepo.seed([existing])

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
    expect(await connectionRepo.all()).toHaveLength(1)
    expect((await outbox.byTag('integration.google_account.connected'))[0]).toMatchObject(
      {
        connectionId: existing.id,
      },
    )
  })

  it('leaves category refresh to the committed fact on reconnect and completed callback retry', async () => {
    const refresh = vi.fn(async () => {})
    const { useCase, connectionRepo, exchangeCode } = await setup(undefined, refresh)
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const existing = buildTestGoogleConnection({
      status: 'disconnected',
      googleSubject: null,
    })
    await connectionRepo.seed([existing])

    const connected = await useCase(
      {
        ...input(),
        connectionMode: 'reconnect',
        targetConnectionId: existing.id,
      },
      ctx,
    )
    expect(refresh).not.toHaveBeenCalled()
    refresh.mockRejectedValueOnce(new Error('category read unavailable'))
    await expect(
      useCase.resume({ attemptId: input().exchangeAttemptId }, ctx),
    ).resolves.toEqual(connected)
    await useCase.resume({ attemptId: input().exchangeAttemptId }, ctx)
    expect(refresh).not.toHaveBeenCalled()
    expect(exchangeCode).toHaveBeenCalledTimes(1)
  })

  it('refuses a reconnect that loses the race to a disconnect and keeps it disconnected', async () => {
    const { useCase, connectionRepo, outbox } = await setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const target = buildTestGoogleConnection({
      googleSubject: 'google-subject-123',
      status: 'reauth_required',
    })
    await connectionRepo.seed([target])
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
    expect(await outbox.byTag('integration.google_account.connected')).toEqual([])
  })

  it('does not let a new ceremony adopt an existing same-organization subject', async () => {
    const { useCase, connectionRepo, outbox } = await setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const existing = buildTestGoogleConnection({
      googleSubject: 'google-subject-123',
      status: 'disconnected',
    })
    await connectionRepo.seed([existing])

    await expect(useCase(input('organization'), ctx)).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) &&
        (error as { code: string }).code === 'account_already_connected',
    )
    expect(await connectionRepo.all()).toEqual([existing])
    expect(await outbox.byTag('integration.google_account.connected')).toEqual([])
  })

  it('rejects a targeted ceremony when the returned subject belongs to another row', async () => {
    const { useCase, connectionRepo, outbox } = await setup()
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
    await connectionRepo.seed([target, mapped])

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
    expect(await connectionRepo.all()).toEqual([target, mapped])
    expect(await outbox.byTag('integration.google_account.connected')).toEqual([])
  })

  it('rejects a signed subject already claimed by another organization', async () => {
    const { useCase, connectionRepo } = await setup()
    await connectionRepo.seed([
      buildTestGoogleConnection({
        googleSubject: 'google-subject-123',
        organizationId: OTHER_ORG,
      }),
    ])

    await expect(
      useCase(input(), buildTestAuthContext({ role: 'AccountAdmin' })),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) &&
        (error as { code: string }).code === 'account_already_connected',
    )
    expect(await connectionRepo.all()).toHaveLength(1)
  })

  it('derives token expiry and normalizes legacy visibility to Organization ownership', async () => {
    const { useCase, connectionRepo, oauth } = await setup()
    oauth.setExchangeResult({
      identity: { kind: 'oidc', googleSubject: 'google-subject-123', email: null },
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      expiresIn: 7200,
      scopes: ['https://www.googleapis.com/auth/business.manage'],
    })

    await useCase(input('private'), buildTestAuthContext({ role: 'AccountAdmin' }))

    expect((await connectionRepo.all())[0]).toMatchObject({
      tokenExpiresAt: new Date('2026-04-10T14:00:00Z'),
      visibility: 'organization',
    })
  })

  it('does not let a PropertyManager connect even with forged legacy permissions', async () => {
    const { useCase, oauth } = await setup()
    const manager = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(useCase(input(), manager)).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) && (error as { code: string }).code === 'forbidden',
    )
    expect(oauth.exchangeVerifierCalls()).toEqual([])
  })
})
