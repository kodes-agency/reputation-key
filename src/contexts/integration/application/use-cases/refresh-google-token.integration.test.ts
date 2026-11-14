// Integration context — refresh Google token use case tests

import { afterAll, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest'
import { refreshGoogleToken } from './refresh-google-token'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import {
  createGoogleConnectionTestStore,
  createOutboxReader,
} from '#/contexts/integration/connections/google-connection.test-fixtures'
import { createAtomicIntegrationCommandStore } from '../../infrastructure/integration-command-store'
import { createInMemoryGoogleOAuthPort } from '#/shared/testing/in-memory-google-oauth-port'
import { createTestTokenEncryption } from '#/contexts/integration/connections/token-encryption.test-fixtures'
import { buildTestGoogleConnection } from '#/shared/testing/fixtures'
import { isIntegrationError } from '../../domain/errors'
import { organizationId, userId } from '#/shared/domain/ids'
import type { GoogleOAuthProviderCallAuthorizer } from '../ports/google-oauth.port'
import type { GoogleAuthorizedProviderExecutor } from '../ports/google-authorized-provider-executor.port'
import type { GoogleRefreshCoordination } from '../ports/google-refresh-coordination.port'
import { createGoogleOAuthAdapter } from '../../infrastructure/adapters/google-oauth.adapter'

const FIXED_NOW = new Date('2026-01-15T12:00:00Z')
const clock = () => FIXED_NOW

const ORG_ID = organizationId('org-refresh-token-aa')
const OTHER_ORG_ID = organizationId('org-refresh-token-bb')

setupIntegrationDb({
  orgA: ORG_ID,
  orgB: OTHER_ORG_ID,
  tables: ['google_connections', 'outbox_events'],
})

beforeAll(registerAllEventSchemas)
afterAll(clearEventSchemas)

const sealed = createTestTokenEncryption()
const openAccessToken = (connection: { encryptedAccessToken: string }) =>
  sealed.decrypt(connection.encryptedAccessToken)
const openRefreshToken = (connection: { encryptedRefreshToken: string }) =>
  sealed.decrypt(connection.encryptedRefreshToken)

const buildConnection = (
  overrides: Parameters<typeof buildTestGoogleConnection>[0] = {},
) =>
  buildTestGoogleConnection({
    organizationId: ORG_ID,
    encryptedAccessToken: sealed.encrypt('stored-access-token'),
    encryptedRefreshToken: sealed.encrypt('stored-refresh-token'),
    ...overrides,
  })

const setup = () => {
  const db = getDb()
  const connectionRepo = createGoogleConnectionTestStore(db, clock, [ORG_ID])
  const outbox = createOutboxReader(db, [ORG_ID])
  const commandStore = createAtomicIntegrationCommandStore(db, clock)
  const oauth = createInMemoryGoogleOAuthPort()
  const encryption = createTestTokenEncryption()
  const deps = { connectionRepo, commandStore, oauth, encryption, clock }
  const useCase = refreshGoogleToken(deps)
  return { useCase, connectionRepo, commandStore, outbox, oauth, encryption }
}

describe('refreshGoogleToken', () => {
  it('returns connection as-is when token is still valid', async () => {
    const { useCase, connectionRepo } = setup()
    // Token expires 1 hour from FIXED_NOW — well beyond the 5-minute buffer
    const farFuture = new Date(FIXED_NOW.getTime() + 60 * 60 * 1000)
    const connection = buildConnection({
      status: 'active',
      tokenExpiresAt: farFuture,
    })
    await connectionRepo.seed([connection])

    const result = await useCase(ORG_ID, connection.id as string)

    expect(result.tokenExpiresAt).toEqual(farFuture)
    expect(result.encryptedAccessToken).toBe(connection.encryptedAccessToken)
  })

  it('forces a refresh after a provider 401 even when the token is not near expiry', async () => {
    const { useCase, connectionRepo, oauth } = setup()
    const connection = buildConnection({
      status: 'active',
      tokenExpiresAt: new Date(FIXED_NOW.getTime() + 60 * 60 * 1000),
      credentialGeneration: 7,
    })
    await connectionRepo.seed([connection])
    oauth.setRefreshResult({ accessToken: 'forced-access-token', expiresIn: 3600 })

    const result = await useCase(ORG_ID, connection.id, {
      force: true,
      expectedCredentialGeneration: 7,
    })

    expect(openAccessToken(result)).toBe('forced-access-token')
    expect(result.credentialGeneration).toBe(8)
    expect(result.accessVersion).toBe(connection.accessVersion)
  })

  it('uses a newer credential without refreshing when the failed generation is stale', async () => {
    const { useCase, connectionRepo, oauth } = setup()
    const connection = buildConnection({
      status: 'active',
      tokenExpiresAt: new Date(FIXED_NOW.getTime() + 60 * 60 * 1000),
      credentialGeneration: 8,
      encryptedAccessToken: sealed.encrypt('newer-access-token'),
    })
    await connectionRepo.seed([connection])

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
    const connection = buildConnection({
      status: 'active',
      tokenExpiresAt: past,
      encryptedAccessToken: sealed.encrypt('old-access-token'),
      encryptedRefreshToken: sealed.encrypt('old-refresh-token'),
    })
    await connectionRepo.seed([connection])

    oauth.setRefreshResult({ accessToken: 'new-access-token', expiresIn: 3600 })

    const result = await useCase(ORG_ID, connection.id as string)

    expect(openAccessToken(result)).toBe('new-access-token')
    // Token expiry should be FIXED_NOW + 3600*1000
    expect(result.tokenExpiresAt.getTime()).toBe(FIXED_NOW.getTime() + 3600 * 1000)
  })

  it('authorizes refresh as the AccountAdmin who owns the current grant, not first-connection provenance', async () => {
    const { connectionRepo, commandStore, oauth, encryption } = setup()
    const currentGrantOwner = userId('user-current-google-grant-owner')
    const connection = buildConnection({
      connectedBy: userId('user-original-google-connector'),
      credentialAuthorizedBy: currentGrantOwner,
      tokenExpiresAt: new Date(FIXED_NOW.getTime() - 60 * 60 * 1000),
    })
    await connectionRepo.seed([connection])
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
      useCase(ORG_ID, 'e0000009-0000-0000-0000-000000000009'),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) && error.code === 'connection_not_found',
    )
  })

  it('throws for disconnected connections', async () => {
    const { useCase, connectionRepo } = setup()
    const connection = buildConnection({
      status: 'disconnected',
      tokenExpiresAt: new Date(FIXED_NOW.getTime() - 60 * 60 * 1000),
    })
    await connectionRepo.seed([connection])

    await expect(useCase(ORG_ID, connection.id as string)).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) && error.code === 'connection_disconnected',
    )
  })

  it('keeps the same refresh token after update', async () => {
    const { useCase, connectionRepo, oauth } = setup()
    const past = new Date(FIXED_NOW.getTime() - 60 * 60 * 1000)
    const connection = buildConnection({
      status: 'active',
      tokenExpiresAt: past,
      encryptedRefreshToken: sealed.encrypt('original-refresh-token'),
    })
    await connectionRepo.seed([connection])

    oauth.setRefreshResult({ accessToken: 'refreshed-access', expiresIn: 3600 })

    const result = await useCase(ORG_ID, connection.id as string)

    // Refresh token should remain unchanged — only access token changes
    expect(openRefreshToken(result)).toBe('original-refresh-token')
    expect(openAccessToken(result)).toBe('refreshed-access')
  })

  it('rejects cleanup-only credentials before decrypting or refreshing', async () => {
    const { useCase, connectionRepo } = setup()
    const connection = buildConnection({
      credentialUseState: 'cleanup_only',
      tokenExpiresAt: new Date(FIXED_NOW.getTime() - 60 * 60 * 1000),
    })
    await connectionRepo.seed([connection])

    await expect(useCase(ORG_ID, connection.id)).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) && error.code === 'connection_disconnected',
    )
  })

  it('discards a provider refresh when credential authority is removed before commit', async () => {
    const { connectionRepo, commandStore, oauth, encryption } = setup()
    const connection = buildConnection({
      tokenExpiresAt: new Date(FIXED_NOW.getTime() - 60 * 60 * 1000),
    })
    await connectionRepo.seed([connection])
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
    expect((await connectionRepo.all())[0]?.encryptedAccessToken).toBe(
      connection.encryptedAccessToken,
    )
  })

  it('coordinates a refresh across replicas and accepts the committed credential generation', async () => {
    const { connectionRepo, commandStore, oauth, encryption } = setup()
    const connection = buildConnection({
      tokenExpiresAt: new Date(FIXED_NOW.getTime() - 60 * 60 * 1000),
      credentialGeneration: 7,
    })
    const committed = buildConnection({
      ...connection,
      encryptedAccessToken: sealed.encrypt('replica-committed-access-token'),
      tokenExpiresAt: new Date(FIXED_NOW.getTime() + 60 * 60 * 1000),
      credentialGeneration: 8,
    })
    await connectionRepo.seed([connection])
    let coordinationCalls = 0
    const coordination: GoogleRefreshCoordination = {
      run: async (input) => {
        coordinationCalls += 1
        expect(input.organizationId).toBe(ORG_ID)
        expect(input.connectionId).toBe(connection.id)
        expect(input.expectedCredentialGeneration).toBe(7)
        await connectionRepo.replace(committed)
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
    const connection = buildConnection({
      tokenExpiresAt: new Date(FIXED_NOW.getTime() - 60 * 60 * 1000),
    })
    await connectionRepo.seed([connection])
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
  const execute = vi.fn<GoogleAuthorizedProviderExecutor['execute']>()
  const expired = new Date(FIXED_NOW.getTime() - 60 * 60 * 1000)

  beforeEach(() => {
    execute.mockReset()
  })

  const tokenEndpointAnswers = (status: number, body: unknown) =>
    execute.mockImplementation(async () => ({
      ok: true,
      status,
      headers: {
        contentType: 'application/json; charset=utf-8',
        cacheControl: null,
        retryAfter: null,
      },
      body: new TextEncoder().encode(JSON.stringify(body)),
    }))

  const authorizeProviderCall: GoogleOAuthProviderCallAuthorizer = async (input) => ({
    capability: 'property.import_gbp_v2',
    organizationId: input.organizationId,
    propertyId: null,
    connectionId: input.connectionId,
    initiatorUserId: input.initiatorUserId,
    expectedCredentialGeneration: 1,
    authorizationVector: { credentialGeneration: 1 },
  })
  const oauthConfig = {
    clientId: 'rep-key-client',
    clientSecret: 'client-secret',
    jwksUrl: 'https://oauth.example.test/jwks',
    clock,
    executor: { execute },
  }

  /** Real refresh classification and command decisions, with fake provider transport. */
  const wiredToGoogle = () => {
    const { connectionRepo, commandStore, outbox, encryption } = setup()
    const oauth = createGoogleOAuthAdapter(oauthConfig)
    const useCase = refreshGoogleToken({
      connectionRepo,
      commandStore,
      oauth,
      encryption,
      clock,
      authorizeProviderCall,
    })
    return { useCase, connectionRepo, commandStore, outbox, oauth, encryption }
  }

  const requiresReauthorization = (error: unknown) =>
    isIntegrationError(error) && error.code === 'reauthorization_required'

  it('moves the connection to reauth_required and records why, in one step', async () => {
    const { useCase, connectionRepo, outbox } = wiredToGoogle()
    const connection = buildConnection({
      tokenExpiresAt: expired,
      lifecycleVersion: 4,
      credentialGeneration: 6,
    })
    await connectionRepo.seed([connection])
    tokenEndpointAnswers(400, {
      error: 'invalid_grant',
      error_description: 'Token has been expired or revoked.',
    })

    await expect(useCase(ORG_ID, connection.id)).rejects.toSatisfy(
      requiresReauthorization,
    )

    expect((await connectionRepo.all())[0]).toMatchObject({
      status: 'reauth_required',
      credentialUseState: 'active',
      credentialGeneration: 6,
    })
    expect(await outbox.facts()).toEqual([
      expect.objectContaining({
        _tag: 'integration.google_account.reauthorization_required',
        connectionId: connection.id,
        organizationId: ORG_ID,
        cause: 'provider_revoked',
        occurredAt: FIXED_NOW.toISOString(),
      }),
    ])
  })

  it('never asks Google again once the connection needs reauthorization', async () => {
    const { useCase, connectionRepo, outbox } = wiredToGoogle()
    const connection = buildConnection({ tokenExpiresAt: expired })
    await connectionRepo.seed([connection])
    tokenEndpointAnswers(400, { error: 'invalid_grant' })

    await expect(useCase(ORG_ID, connection.id)).rejects.toSatisfy(
      requiresReauthorization,
    )
    await expect(useCase(ORG_ID, connection.id)).rejects.toSatisfy(
      requiresReauthorization,
    )

    expect(execute).toHaveBeenCalledTimes(1)
    expect(await outbox.facts()).toHaveLength(1)
  })

  it('keeps a failure Google may recover from retryable and the connection active', async () => {
    const { useCase, connectionRepo, outbox } = wiredToGoogle()
    const connection = buildConnection({ tokenExpiresAt: expired })
    await connectionRepo.seed([connection])
    tokenEndpointAnswers(503, { error: 'backend_error' })

    await expect(useCase(ORG_ID, connection.id)).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) && error.code === 'token_refresh_failed',
    )

    expect((await connectionRepo.all())[0]?.status).toBe('active')
    expect(await outbox.facts()).toEqual([])
  })

  it('leaves a reconnect that committed during the refresh untouched', async () => {
    const { connectionRepo, commandStore, outbox, encryption } = wiredToGoogle()
    const connection = buildConnection({
      tokenExpiresAt: expired,
      lifecycleVersion: 4,
      credentialGeneration: 6,
    })
    const reconnected = buildConnection({
      ...connection,
      encryptedRefreshToken: sealed.encrypt('fresh-consent-refresh-token'),
      lifecycleVersion: 5,
      credentialGeneration: 7,
    })
    await connectionRepo.seed([connection])
    tokenEndpointAnswers(400, { error: 'invalid_grant' })
    const useCase = refreshGoogleToken({
      connectionRepo,
      commandStore: {
        requireReauthorization: async (command) => {
          await connectionRepo.replace(reconnected)
          return commandStore.requireReauthorization(command)
        },
      },
      oauth: createGoogleOAuthAdapter(oauthConfig),
      authorizeProviderCall,
      encryption,
      clock,
    })

    await expect(useCase(ORG_ID, connection.id)).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) && error.code === 'connection_disconnected',
    )

    expect(await connectionRepo.all()).toEqual([reconnected])
    expect(await outbox.facts()).toEqual([])
  })

  it('refuses a connection that already needs reauthorization before any provider work', async () => {
    const { useCase, connectionRepo, oauth, encryption } = setup()
    const decrypt = vi.spyOn(encryption, 'decrypt')
    const connection = buildConnection({
      status: 'reauth_required',
      tokenExpiresAt: expired,
    })
    await connectionRepo.seed([connection])

    await expect(useCase(ORG_ID, connection.id)).rejects.toSatisfy(
      requiresReauthorization,
    )
    expect(decrypt).not.toHaveBeenCalled()
    expect(oauth.refreshAccessTokenCalls()).toEqual([])
  })

  it('stops a waiting replica once another replica found the grant revoked', async () => {
    const { connectionRepo, commandStore, oauth, encryption } = setup()
    const connection = buildConnection({ tokenExpiresAt: expired })
    await connectionRepo.seed([connection])
    const coordination: GoogleRefreshCoordination = {
      run: async (input) => {
        // The leader on another replica has just recorded the revocation.
        await connectionRepo.replace({
          ...connection,
          status: 'reauth_required',
          lifecycleVersion: connection.lifecycleVersion + 1,
        })
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
