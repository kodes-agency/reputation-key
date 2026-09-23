// Integration context — refresh Google token use case tests

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { refreshGoogleToken } from './refresh-google-token'
import { createInMemoryGoogleConnectionRepo } from '#/shared/testing/in-memory-google-connection-repo'
import { createInMemoryGoogleOAuthPort } from '#/shared/testing/in-memory-google-oauth-port'
import { createInMemoryTokenEncryption } from '#/shared/testing/in-memory-token-encryption'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { createSequentialIntegrationCommandStore } from '#/shared/testing/sequential-integration-command-store'
import { buildTestGoogleConnection } from '#/shared/testing/fixtures'
import { isIntegrationError } from '../../domain/errors'
import { organizationId, userId } from '#/shared/domain/ids'
import type { GoogleRefreshCoordination } from '../ports/google-refresh-coordination.port'
import { createGoogleOAuthAdapter } from '../../infrastructure/adapters/google-oauth.adapter'

const FIXED_NOW = new Date('2026-01-15T12:00:00Z')
const clock = () => FIXED_NOW

const setup = () => {
  const connectionRepo = createInMemoryGoogleConnectionRepo()
  const outbox = createRecordedOutbox()
  const commandStore = createSequentialIntegrationCommandStore({ connectionRepo, outbox })
  const oauth = createInMemoryGoogleOAuthPort()
  const encryption = createInMemoryTokenEncryption()
  const deps = { connectionRepo, commandStore, oauth, encryption, clock }
  const useCase = refreshGoogleToken(deps)
  return { useCase, connectionRepo, commandStore, outbox, oauth, encryption }
}

const ORG_ID = organizationId('org-00000000-0000-0000-0000-000000000001')

describe('refreshGoogleToken', () => {
  it('returns connection as-is when token is still valid', async () => {
    const { useCase, connectionRepo } = setup()
    // Token expires 1 hour from FIXED_NOW — well beyond the 5-minute buffer
    const farFuture = new Date(FIXED_NOW.getTime() + 60 * 60 * 1000)
    const connection = buildTestGoogleConnection({
      status: 'active',
      tokenExpiresAt: farFuture,
    })
    connectionRepo.seed([connection])

    const result = await useCase(ORG_ID, connection.id as string)

    expect(result.tokenExpiresAt).toEqual(farFuture)
    expect(result.encryptedAccessToken).toBe(connection.encryptedAccessToken)
  })

  it('forces a refresh after a provider 401 even when the token is not near expiry', async () => {
    const { useCase, connectionRepo, oauth } = setup()
    const connection = buildTestGoogleConnection({
      status: 'active',
      tokenExpiresAt: new Date(FIXED_NOW.getTime() + 60 * 60 * 1000),
      credentialGeneration: 7,
    })
    connectionRepo.seed([connection])
    oauth.setRefreshResult({ accessToken: 'forced-access-token', expiresIn: 3600 })

    const result = await useCase(ORG_ID, connection.id, {
      force: true,
      expectedCredentialGeneration: 7,
    })

    expect(result.encryptedAccessToken).toBe('enc:forced-access-token')
    expect(result.credentialGeneration).toBe(8)
    expect(result.accessVersion).toBe(connection.accessVersion)
  })

  it('uses a newer credential without refreshing when the failed generation is stale', async () => {
    const { useCase, connectionRepo, oauth } = setup()
    const connection = buildTestGoogleConnection({
      status: 'active',
      tokenExpiresAt: new Date(FIXED_NOW.getTime() + 60 * 60 * 1000),
      credentialGeneration: 8,
      encryptedAccessToken: 'enc:newer-access-token',
    })
    connectionRepo.seed([connection])

    const result = await useCase(ORG_ID, connection.id, {
      force: true,
      expectedCredentialGeneration: 7,
    })

    expect(result).toEqual(connection)
    expect(oauth.refreshAccessTokenCalls()).toEqual([])
  })

  it('refreshes token when expired, encrypts, updates, and returns updated', async () => {
    const { useCase, connectionRepo, oauth } = setup()
    // Token expired 1 hour before FIXED_NOW
    const past = new Date(FIXED_NOW.getTime() - 60 * 60 * 1000)
    const connection = buildTestGoogleConnection({
      status: 'active',
      tokenExpiresAt: past,
      encryptedAccessToken: 'enc:old-access-token',
      encryptedRefreshToken: 'enc:old-refresh-token',
    })
    connectionRepo.seed([connection])

    oauth.setRefreshResult({ accessToken: 'new-access-token', expiresIn: 3600 })

    const result = await useCase(ORG_ID, connection.id as string)

    expect(result.encryptedAccessToken).toBe('enc:new-access-token')
    // Token expiry should be FIXED_NOW + 3600*1000
    expect(result.tokenExpiresAt.getTime()).toBe(FIXED_NOW.getTime() + 3600 * 1000)
  })

  it('authorizes refresh as the AccountAdmin who owns the current grant, not first-connection provenance', async () => {
    const { connectionRepo, commandStore, oauth, encryption } = setup()
    const currentGrantOwner = userId('user-current-google-grant-owner')
    const connection = buildTestGoogleConnection({
      connectedBy: userId('user-original-google-connector'),
      credentialAuthorizedBy: currentGrantOwner,
      tokenExpiresAt: new Date(FIXED_NOW.getTime() - 60 * 60 * 1000),
    })
    connectionRepo.seed([connection])
    const authorizeProviderCall = vi.fn(async () => ({
      capability: 'property.import_gbp_v2' as const,
      organizationId: ORG_ID,
      propertyId: null,
      connectionId: connection.id,
      initiatorUserId: currentGrantOwner,
      expectedCredentialGeneration: connection.credentialGeneration,
      authorizationVector: {
        credentialGeneration: connection.credentialGeneration,
      },
    }))
    const useCase = refreshGoogleToken({
      connectionRepo,
      commandStore,
      oauth,
      encryption,
      clock,
      authorizeProviderCall,
    })

    await useCase(ORG_ID, connection.id)

    expect(authorizeProviderCall).toHaveBeenCalledWith({
      operation: 'oauth.token.refresh',
      organizationId: ORG_ID,
      connectionId: connection.id,
      initiatorUserId: currentGrantOwner,
    })
  })

  it('throws when connection not found', async () => {
    const { useCase } = setup()

    await expect(
      useCase(ORG_ID, 'nonexistent-0000-0000-0000-000000000001'),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) && error.code === 'connection_not_found',
    )
  })

  it('throws for disconnected connections', async () => {
    const { useCase, connectionRepo } = setup()
    const connection = buildTestGoogleConnection({
      status: 'disconnected',
      tokenExpiresAt: new Date(FIXED_NOW.getTime() - 60 * 60 * 1000),
    })
    connectionRepo.seed([connection])

    await expect(useCase(ORG_ID, connection.id as string)).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) && error.code === 'connection_disconnected',
    )
  })

  it('keeps the same refresh token after update', async () => {
    const { useCase, connectionRepo, oauth } = setup()
    const past = new Date(FIXED_NOW.getTime() - 60 * 60 * 1000)
    const connection = buildTestGoogleConnection({
      status: 'active',
      tokenExpiresAt: past,
      encryptedRefreshToken: 'enc:original-refresh-token',
    })
    connectionRepo.seed([connection])

    oauth.setRefreshResult({ accessToken: 'refreshed-access', expiresIn: 3600 })

    const result = await useCase(ORG_ID, connection.id as string)

    // Refresh token should remain unchanged — only access token changes
    expect(result.encryptedRefreshToken).toBe('enc:original-refresh-token')
    expect(result.encryptedAccessToken).toBe('enc:refreshed-access')
  })

  it('rejects cleanup-only credentials before decrypting or refreshing', async () => {
    const { useCase, connectionRepo } = setup()
    const connection = buildTestGoogleConnection({
      credentialUseState: 'cleanup_only',
      tokenExpiresAt: new Date(FIXED_NOW.getTime() - 60 * 60 * 1000),
    })
    connectionRepo.seed([connection])

    await expect(useCase(ORG_ID, connection.id)).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) && error.code === 'connection_disconnected',
    )
  })

  it('discards a provider refresh when credential authority is removed before commit', async () => {
    const { connectionRepo, commandStore, oauth, encryption } = setup()
    const connection = buildTestGoogleConnection({
      tokenExpiresAt: new Date(FIXED_NOW.getTime() - 60 * 60 * 1000),
    })
    connectionRepo.seed([connection])
    const racedRepo = {
      ...connectionRepo,
      updateTokens: async () => false,
    }
    const useCase = refreshGoogleToken({
      connectionRepo: racedRepo,
      commandStore,
      oauth,
      encryption,
      clock,
    })

    await expect(useCase(ORG_ID, connection.id)).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) && error.code === 'connection_disconnected',
    )
    expect(connectionRepo.all()[0]?.encryptedAccessToken).toBe(
      connection.encryptedAccessToken,
    )
  })

  it('coordinates a refresh across replicas and accepts the committed credential generation', async () => {
    const { connectionRepo, commandStore, oauth, encryption } = setup()
    const connection = buildTestGoogleConnection({
      tokenExpiresAt: new Date(FIXED_NOW.getTime() - 60 * 60 * 1000),
      credentialGeneration: 7,
    })
    const committed = buildTestGoogleConnection({
      ...connection,
      encryptedAccessToken: 'enc:replica-committed-access-token',
      tokenExpiresAt: new Date(FIXED_NOW.getTime() + 60 * 60 * 1000),
      credentialGeneration: 8,
    })
    connectionRepo.seed([connection])
    let coordinationCalls = 0
    const coordination: GoogleRefreshCoordination = {
      run: async (input) => {
        coordinationCalls += 1
        expect(input.organizationId).toBe(ORG_ID)
        expect(input.connectionId).toBe(connection.id)
        expect(input.expectedCredentialGeneration).toBe(7)
        connectionRepo.seed([committed])
        const latest = await input.loadLatest()
        if (latest === null) throw new Error('expected committed replica refresh')
        return { ok: true, value: latest }
      },
    }
    const useCase = refreshGoogleToken({
      connectionRepo,
      commandStore,
      oauth,
      encryption,
      clock,
      coordination,
    })

    await expect(useCase(ORG_ID, connection.id)).resolves.toEqual(committed)
    expect(coordinationCalls).toBe(1)
    expect(oauth.refreshAccessTokenCalls()).toEqual([])
  })

  it('fails closed before decrypting or calling Google when shared coordination denies', async () => {
    const { connectionRepo, commandStore, oauth, encryption } = setup()
    const connection = buildTestGoogleConnection({
      tokenExpiresAt: new Date(FIXED_NOW.getTime() - 60 * 60 * 1000),
    })
    connectionRepo.seed([connection])
    const decrypt = vi.spyOn(encryption, 'decrypt')
    const useCase = refreshGoogleToken({
      connectionRepo,
      commandStore,
      oauth,
      encryption,
      clock,
      coordination: {
        run: async () => ({
          ok: false as const,
          code: 'coordination_unavailable' as const,
          retryAfterMs: 0,
        }),
      },
    })

    await expect(useCase(ORG_ID, connection.id)).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) && error.code === 'token_refresh_failed',
    )
    expect(decrypt).not.toHaveBeenCalled()
    expect(oauth.refreshAccessTokenCalls()).toEqual([])
  })
})

// When Google revokes or expires the refresh grant, every refresh is answered
// 400 invalid_grant. The connection used to stay `active`: Settings said
// "Connected", nobody was told to reconnect, and sync and replies failed
// silently for ever.
describe('refreshGoogleToken — a grant Google no longer accepts', () => {
  const fetchMock = vi.fn<typeof fetch>()
  const expired = new Date(FIXED_NOW.getTime() - 60 * 60 * 1000)

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const tokenEndpointAnswers = (status: number, body: unknown) =>
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        }),
    )

  /** The real OAuth adapter on its direct path, against the stubbed endpoint. */
  const wiredToGoogle = () => {
    const { connectionRepo, commandStore, outbox, encryption } = setup()
    const oauth = createGoogleOAuthAdapter({
      clientId: 'rep-key-client',
      clientSecret: 'client-secret',
      tokenUrl: 'https://oauth.example.test/token',
      jwksUrl: 'https://oauth.example.test/jwks',
      revokeUrl: 'https://oauth.example.test/revoke',
      clock,
    })
    const useCase = refreshGoogleToken({
      connectionRepo,
      commandStore,
      oauth,
      encryption,
      clock,
    })
    return { useCase, connectionRepo, commandStore, outbox, oauth, encryption }
  }

  const requiresReauthorization = (error: unknown) =>
    isIntegrationError(error) && error.code === 'reauthorization_required'

  it('moves the connection to reauth_required and records why, in one step', async () => {
    const { useCase, connectionRepo, outbox } = wiredToGoogle()
    const connection = buildTestGoogleConnection({
      tokenExpiresAt: expired,
      lifecycleVersion: 4,
      credentialGeneration: 6,
    })
    connectionRepo.seed([connection])
    tokenEndpointAnswers(400, {
      error: 'invalid_grant',
      error_description: 'Token has been expired or revoked.',
    })

    await expect(useCase(ORG_ID, connection.id)).rejects.toSatisfy(
      requiresReauthorization,
    )

    expect(connectionRepo.all()[0]).toMatchObject({
      status: 'reauth_required',
      credentialUseState: 'active',
      credentialGeneration: 6,
    })
    expect(outbox.facts).toEqual([
      expect.objectContaining({
        _tag: 'integration.google_account.reauthorization_required',
        connectionId: connection.id,
        organizationId: ORG_ID,
        cause: 'provider_revoked',
        occurredAt: FIXED_NOW,
      }),
    ])
  })

  it('never asks Google again once the connection needs reauthorization', async () => {
    const { useCase, connectionRepo, outbox } = wiredToGoogle()
    const connection = buildTestGoogleConnection({ tokenExpiresAt: expired })
    connectionRepo.seed([connection])
    tokenEndpointAnswers(400, { error: 'invalid_grant' })

    await expect(useCase(ORG_ID, connection.id)).rejects.toSatisfy(
      requiresReauthorization,
    )
    await expect(useCase(ORG_ID, connection.id)).rejects.toSatisfy(
      requiresReauthorization,
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(outbox.facts).toHaveLength(1)
  })

  it('keeps a failure Google may recover from retryable and the connection active', async () => {
    const { useCase, connectionRepo, outbox } = wiredToGoogle()
    const connection = buildTestGoogleConnection({ tokenExpiresAt: expired })
    connectionRepo.seed([connection])
    tokenEndpointAnswers(503, { error: 'backend_error' })

    await expect(useCase(ORG_ID, connection.id)).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) && error.code === 'token_refresh_failed',
    )

    expect(connectionRepo.all()[0]?.status).toBe('active')
    expect(outbox.facts).toEqual([])
  })

  it('leaves a reconnect that committed during the refresh untouched', async () => {
    const { connectionRepo, commandStore, outbox, encryption } = wiredToGoogle()
    const connection = buildTestGoogleConnection({
      tokenExpiresAt: expired,
      lifecycleVersion: 4,
      credentialGeneration: 6,
    })
    const reconnected = buildTestGoogleConnection({
      ...connection,
      encryptedRefreshToken: 'enc:fresh-consent-refresh-token',
      lifecycleVersion: 5,
      credentialGeneration: 7,
    })
    connectionRepo.seed([connection])
    tokenEndpointAnswers(400, { error: 'invalid_grant' })
    const useCase = refreshGoogleToken({
      connectionRepo,
      commandStore: {
        requireReauthorization: async (command) => {
          connectionRepo.seed([reconnected])
          return commandStore.requireReauthorization(command)
        },
      },
      oauth: createGoogleOAuthAdapter({
        clientId: 'rep-key-client',
        clientSecret: 'client-secret',
        tokenUrl: 'https://oauth.example.test/token',
        jwksUrl: 'https://oauth.example.test/jwks',
        revokeUrl: 'https://oauth.example.test/revoke',
        clock,
      }),
      encryption,
      clock,
    })

    await expect(useCase(ORG_ID, connection.id)).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) && error.code === 'connection_disconnected',
    )

    expect(connectionRepo.all()).toEqual([reconnected])
    expect(outbox.facts).toEqual([])
  })

  it('refuses a connection that already needs reauthorization before any provider work', async () => {
    const { useCase, connectionRepo, oauth, encryption } = setup()
    const decrypt = vi.spyOn(encryption, 'decrypt')
    const connection = buildTestGoogleConnection({
      status: 'reauth_required',
      tokenExpiresAt: expired,
    })
    connectionRepo.seed([connection])

    await expect(useCase(ORG_ID, connection.id)).rejects.toSatisfy(
      requiresReauthorization,
    )
    expect(decrypt).not.toHaveBeenCalled()
    expect(oauth.refreshAccessTokenCalls()).toEqual([])
  })

  it('stops a waiting replica once another replica found the grant revoked', async () => {
    const { connectionRepo, commandStore, oauth, encryption } = setup()
    const connection = buildTestGoogleConnection({ tokenExpiresAt: expired })
    connectionRepo.seed([connection])
    const coordination: GoogleRefreshCoordination = {
      run: async (input) => {
        // The leader on another replica has just recorded the revocation.
        connectionRepo.seed([
          {
            ...connection,
            status: 'reauth_required',
            lifecycleVersion: connection.lifecycleVersion + 1,
          },
        ])
        const latest = await input.loadLatest()
        if (latest !== null) return { ok: true, value: latest }
        return { ok: true, value: await input.refresh(async () => undefined) }
      },
    }
    const useCase = refreshGoogleToken({
      connectionRepo,
      commandStore,
      oauth,
      encryption,
      clock,
      coordination,
    })

    await expect(useCase(ORG_ID, connection.id)).rejects.toSatisfy(
      requiresReauthorization,
    )
    expect(oauth.refreshAccessTokenCalls()).toEqual([])
  })
})
