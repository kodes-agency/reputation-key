// Integration context — refresh Google token use case tests

import { describe, it, expect, vi } from 'vitest'
import { refreshGoogleToken } from './refresh-google-token'
import { createInMemoryGoogleConnectionRepo } from '#/shared/testing/in-memory-google-connection-repo'
import { createInMemoryGoogleOAuthPort } from '#/shared/testing/in-memory-google-oauth-port'
import { createInMemoryTokenEncryption } from '#/shared/testing/in-memory-token-encryption'
import { buildTestGoogleConnection } from '#/shared/testing/fixtures'
import { isIntegrationError } from '../../domain/errors'
import { organizationId, userId } from '#/shared/domain/ids'
import type { GoogleRefreshCoordination } from '../ports/google-refresh-coordination.port'

const FIXED_NOW = new Date('2026-01-15T12:00:00Z')
const clock = () => FIXED_NOW
const assertDirectCredentialUse = async () => undefined

const setup = () => {
  const connectionRepo = createInMemoryGoogleConnectionRepo()
  const oauth = createInMemoryGoogleOAuthPort()
  const encryption = createInMemoryTokenEncryption()
  const deps = { connectionRepo, oauth, encryption, clock, assertDirectCredentialUse }
  const useCase = refreshGoogleToken(deps)
  return { useCase, connectionRepo, oauth, encryption }
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
    const { connectionRepo, oauth, encryption } = setup()
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
      oauth,
      encryption,
      clock,
      assertDirectCredentialUse,
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
    const { connectionRepo, oauth, encryption } = setup()
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
      oauth,
      encryption,
      clock,
      assertDirectCredentialUse,
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
    const { connectionRepo, oauth, encryption } = setup()
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
      oauth,
      encryption,
      clock,
      coordination,
      assertDirectCredentialUse,
    })

    await expect(useCase(ORG_ID, connection.id)).resolves.toEqual(committed)
    expect(coordinationCalls).toBe(1)
    expect(oauth.refreshAccessTokenCalls()).toEqual([])
  })

  it('fails closed before decrypting or calling Google when shared coordination denies', async () => {
    const { connectionRepo, oauth, encryption } = setup()
    const connection = buildTestGoogleConnection({
      tokenExpiresAt: new Date(FIXED_NOW.getTime() - 60 * 60 * 1000),
    })
    connectionRepo.seed([connection])
    const decrypt = vi.spyOn(encryption, 'decrypt')
    const useCase = refreshGoogleToken({
      connectionRepo,
      oauth,
      encryption,
      clock,
      assertDirectCredentialUse,
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
