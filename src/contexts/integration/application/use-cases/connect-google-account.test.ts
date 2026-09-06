// Integration context — connect Google account use case tests

import { describe, expect, it, vi } from 'vitest'
import { connectGoogleAccount } from './connect-google-account'
import { DATA_CELL_CATALOGUE_POLICY_VERSION } from '#/shared/domain/data-cell-catalogue'
import { createInMemoryGoogleConnectionRepo } from '#/shared/testing/in-memory-google-connection-repo'
import { createSequentialIntegrationCommandStore } from '#/shared/testing/sequential-integration-command-store'
import { createInMemoryGoogleOAuthPort } from '#/shared/testing/in-memory-google-oauth-port'
import { createInMemoryTokenEncryption } from '#/shared/testing/in-memory-token-encryption'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import {
  buildTestAuthContext,
  buildTestGoogleConnection,
} from '#/shared/testing/fixtures'
import { isIntegrationError } from '../../domain/errors'
import { organizationId } from '#/shared/domain/ids'
import { createGoogleCredentialHomeCapture } from '../google-credential-home'
import type { OrganizationGoogleCredentialHomeInspection } from '../ports/organization-google-credential-home-authority.port'
import type { GoogleOAuthProviderCallAuthorizer } from '../ports/google-oauth.port'
import type {
  GoogleOAuthExchangeAttemptFacts,
  GoogleOAuthExchangeRecoveryStore,
} from '../google-oauth-exchange-recovery'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')
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

const setup = (authorizeProviderCall?: GoogleOAuthProviderCallAuthorizer) => {
  const connectionRepo = createInMemoryGoogleConnectionRepo()
  const oauth = createInMemoryGoogleOAuthPort()
  let attempt:
    | (GoogleOAuthExchangeAttemptFacts & {
        state:
          | 'prepared'
          | 'provider_started'
          | 'response_preserved'
          | 'applying'
          | 'completed'
        encryptedResult?: string
      })
    | undefined
  const exchangeRecovery: GoogleOAuthExchangeRecoveryStore = {
    begin: async (value) => {
      attempt = { ...value, state: 'prepared' }
      return { ok: true, value: { state: 'prepared' } }
    },
    markProviderStarted: async () => {
      if (!attempt || attempt.state !== 'prepared') {
        return { ok: false, code: 'invalid_transition' }
      }
      attempt.state = 'provider_started'
      return { ok: true, value: { started: true } }
    },
    preserveSuccessfulResult: async ({ encryptedResult }) => {
      if (!attempt || attempt.state !== 'provider_started') {
        return { ok: false, code: 'invalid_transition' }
      }
      attempt.state = 'response_preserved'
      attempt.encryptedResult = encryptedResult
      return { ok: true, value: { preserved: true } }
    },
    claimPreservedResult: async () => {
      if (attempt?.state === 'completed') {
        return { ok: false, code: 'completed' }
      }
      if (
        !attempt ||
        attempt.state !== 'response_preserved' ||
        !attempt.encryptedResult
      ) {
        return { ok: false, code: 'invalid_transition' }
      }
      attempt.state = 'applying'
      return {
        ok: true,
        value: { ...attempt, encryptedResult: attempt.encryptedResult },
      } as const satisfies Awaited<
        ReturnType<GoogleOAuthExchangeRecoveryStore['claimPreservedResult']>
      >
    },
    loadCompletedAttempt: async ({ id, organizationId, initiatorUserId }) =>
      attempt?.state === 'completed' &&
      attempt.id === id &&
      attempt.organizationId === organizationId &&
      attempt.initiatorUserId === initiatorUserId
        ? attempt
        : null,
    releaseClaim: async () => ({ ok: true, value: { released: true } }),
    discardClaim: async () => ({ ok: true, value: { discarded: true } }),
    finishWithoutResult: async () => ({ ok: true, value: { finished: true } }),
    expire: async () => ({ expired: 0 }),
  }
  const originalExchange = oauth.exchangeCode
  const exchangeCode = vi.fn(async (request: Parameters<typeof originalExchange>[0]) => {
    if (request.preservedResult) {
      return {
        identity: { kind: 'oidc' as const, googleSubject: 'google-subject-123' },
        accessToken: request.preservedResult.accessToken,
        refreshToken: request.preservedResult.refreshToken,
        expiresIn: request.preservedResult.expiresIn,
        scopes: request.preservedResult.scopes,
      }
    }
    const result = await originalExchange(request)
    await request.preserveSuccessfulResult?.({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      scopes: result.scopes,
      idToken: 'fake-signed-id-token',
    })
    return result
  })
  const recoverableOauth = {
    ...oauth,
    exchangeCode,
  }
  const encryption = createInMemoryTokenEncryption()
  const outbox = createRecordedOutbox()
  let credentialHomeInspection: OrganizationGoogleCredentialHomeInspection = {
    authority: {
      organizationId: organizationId('org-default'),
      homeCellId: 'us' as const,
      cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
      authorityGeneration: 1,
      createdAt: FIXED_TIME,
      updatedAt: FIXED_TIME,
    },
    otherActiveGrantCount: 0,
  }
  const useCase = connectGoogleAccount({
    connectionRepo,
    oauth: recoverableOauth,
    encryption,
    commandStore: createSequentialIntegrationCommandStore({ connectionRepo, outbox }),
    exchangeRecovery,
    clock: () => FIXED_TIME,
    idGen: () => 'test-connection-id',
    callbackUrl: 'http://localhost:3000/api/auth/google/callback',
    captureCredentialHome: createGoogleCredentialHomeCapture({
      authority: {
        inspectForCredentialExchange: async ({ organizationId: requestedOrg }) => ({
          ...credentialHomeInspection,
          authority: credentialHomeInspection.authority
            ? { ...credentialHomeInspection.authority, organizationId: requestedOrg }
            : null,
        }),
        reserveForCredentialExchange: async () => undefined,
      },
      localCellId: 'us',
    }),
    ...(authorizeProviderCall ? { authorizeProviderCall } : {}),
  })
  return {
    useCase,
    connectionRepo,
    oauth,
    exchangeCode,
    outbox,
    markAttemptCompleted: () => {
      if (!attempt || attempt.state !== 'applying') {
        throw new Error('Expected an applying OAuth exchange attempt')
      }
      attempt.state = 'completed'
      delete attempt.encryptedResult
    },
    setCredentialHomeInspection: (value: typeof credentialHomeInspection) => {
      credentialHomeInspection = value
    },
  }
}

describe('connectGoogleAccount', () => {
  it('creates an OIDC connection and records the v2 lifecycle fact', async () => {
    const { useCase, connectionRepo, outbox, oauth } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const result = await useCase(input(), ctx)

    expect(connectionRepo.all()).toHaveLength(1)
    expect(result.googleSubject).toBe('google-subject-123')
    expect(result.status).toBe('active')
    expect(result.organizationId).toBe(ctx.organizationId)
    expect(result.credentialHomeCellId).toBe('us')
    expect(result.credentialHomePolicyVersion).toBe(DATA_CELL_CATALOGUE_POLICY_VERSION)
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
      useCase(input(), buildTestAuthContext({ role: 'Staff' })),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) && (error as { code: string }).code === 'forbidden',
    )
    expect(oauth.exchangeVerifierCalls()).toEqual([])
  })

  it('fails before OAuth when an active legacy grant has no credential home', async () => {
    const { useCase, connectionRepo, oauth, setCredentialHomeInspection } = setup()
    connectionRepo.seed([
      buildTestGoogleConnection({
        credentialHomeCellId: null,
        credentialHomePolicyVersion: null,
      }),
    ])
    setCredentialHomeInspection({ authority: null, otherActiveGrantCount: 1 })
    await expect(
      useCase(input(), buildTestAuthContext({ role: 'AccountAdmin' })),
    ).rejects.toThrow('credential home is unavailable')
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
      status: 'active',
      visibility: 'organization',
      scopes: ['openid', 'https://www.googleapis.com/auth/business.manage'],
    })
    expect(connectionRepo.all()).toHaveLength(1)
    expect(outbox.byTag('integration.google_account.connected')[0]).toMatchObject({
      connectionId: existing.id,
    })
  })

  it('uses governed reconnect to capture a home for a disconnected legacy row', async () => {
    const { useCase, connectionRepo, setCredentialHomeInspection } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const existing = buildTestGoogleConnection({
      googleSubject: 'google-subject-123',
      status: 'disconnected',
      credentialUseState: 'none',
      credentialHomeCellId: null,
      credentialHomePolicyVersion: null,
    })
    connectionRepo.seed([existing])
    setCredentialHomeInspection({ authority: null, otherActiveGrantCount: 0 })

    const result = await useCase(
      {
        ...input('organization'),
        connectionMode: 'reconnect',
        targetConnectionId: existing.id,
      },
      ctx,
    )
    expect(result).toMatchObject({
      credentialHomeCellId: 'us',
      credentialHomePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
      credentialUseState: 'active',
    })
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
      identity: { kind: 'oidc', googleSubject: 'google-subject-123' },
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
