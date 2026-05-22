// Integration context — refresh Google token use case tests

import { describe, it, expect } from 'vitest'
import { refreshGoogleToken } from './refresh-google-token'
import { createInMemoryGoogleConnectionRepo } from '#/shared/testing/in-memory-google-connection-repo'
import { createInMemoryGoogleOAuthPort } from '#/shared/testing/in-memory-google-oauth-port'
import { createInMemoryTokenEncryption } from '#/shared/testing/in-memory-token-encryption'
import { buildTestGoogleConnection } from '#/shared/testing/fixtures'
import { isIntegrationError } from '../../domain/errors'
import { organizationId } from '#/shared/domain/ids'

const FIXED_NOW = new Date('2026-01-15T12:00:00Z')
const clock = () => FIXED_NOW

const setup = () => {
  const connectionRepo = createInMemoryGoogleConnectionRepo()
  const oauth = createInMemoryGoogleOAuthPort()
  const encryption = createInMemoryTokenEncryption()
  const deps = { connectionRepo, oauth, encryption, clock }
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

  it('throws when connection not found', async () => {
    const { useCase } = setup()

    await expect(
      useCase(ORG_ID, 'nonexistent-0000-0000-0000-000000000001'),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isIntegrationError(e) && (e as { code: string }).code === 'connection_not_found',
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
      (e: unknown) =>
        isIntegrationError(e) &&
        (e as { code: string }).code === 'connection_disconnected',
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
})
