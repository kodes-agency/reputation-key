// Integration context — disconnect Google account use case tests

import { describe, it, expect } from 'vitest'
import { disconnectGoogleAccount } from './disconnect-google-account'
import { createInMemoryGoogleConnectionRepo } from '#/shared/testing/in-memory-google-connection-repo'
import { createInMemoryGoogleOAuthPort } from '#/shared/testing/in-memory-google-oauth-port'
import { createInMemoryTokenEncryption } from '#/shared/testing/in-memory-token-encryption'
import { createInMemoryGbpCacheRepo } from '#/shared/testing/in-memory-gbp-cache-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import {
  buildTestAuthContext,
  buildTestGoogleConnection,
} from '#/shared/testing/fixtures'
import { isIntegrationError } from '../../domain/errors'
import { propertyId } from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const setup = () => {
  const connectionRepo = createInMemoryGoogleConnectionRepo()
  const oauth = createInMemoryGoogleOAuthPort()
  const encryption = createInMemoryTokenEncryption()
  const cacheRepo = createInMemoryGbpCacheRepo()
  const events = createCapturingEventBus()
  const deps = {
    connectionRepo,
    oauth,
    encryption,
    cacheRepo,
    events,
    clock: () => FIXED_TIME,
  }
  const useCase = disconnectGoogleAccount(deps)
  return { useCase, connectionRepo, oauth, encryption, cacheRepo, events }
}

describe('disconnectGoogleAccount', () => {
  it('updates status to disconnected, purges cache, and emits event', async () => {
    const { useCase, connectionRepo, cacheRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const connection = buildTestGoogleConnection({ status: 'active' })
    connectionRepo.seed([connection])

    // Seed a cache entry tied to the connection
    const testPropertyId = propertyId('a0000000-0000-0000-0000-000000000001')
    const cacheEntry = {
      id: 'cache-001',
      organizationId: ctx.organizationId,
      propertyId: testPropertyId,
      gbpPlaceId: 'ChIJ-test',
      dataType: 'location' as const,
      payload: {},
      googleAttribution: null,
      fetchedAt: FIXED_TIME,
      expiresAt: new Date('2026-05-10T12:00:00Z'),
    }
    cacheRepo.seed([cacheEntry])
    cacheRepo.testSetConnectionForProperty(
      connection.id as string,
      testPropertyId as string,
    )

    const result = await useCase({ connectionId: connection.id as string }, ctx)

    expect(result.status).toBe('disconnected')
    expect(cacheRepo.all()).toHaveLength(0)

    const emitted = events.capturedByTag('google_account.disconnected')
    expect(emitted).toHaveLength(1)
    expect(emitted[0].connectionId).toBe(connection.id)
    expect(emitted[0].organizationId).toBe(ctx.organizationId)
  })

  it('rejects users without integration.manage permission', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(useCase({ connectionId: 'any-id' }, ctx)).rejects.toSatisfy(
      (e: unknown) =>
        isIntegrationError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  it('throws when connection not found', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(
      useCase({ connectionId: 'nonexistent-0000-0000-0000-000000000001' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isIntegrationError(e) && (e as { code: string }).code === 'connection_not_found',
    )
  })

  it('returns early when connection is already disconnected', async () => {
    const { useCase, connectionRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const connection = buildTestGoogleConnection({ status: 'disconnected' })
    connectionRepo.seed([connection])

    const result = await useCase({ connectionId: connection.id as string }, ctx)

    expect(result.status).toBe('disconnected')
    // No cache purge or event emission for already-disconnected connections
    expect(events.capturedByTag('google_account.disconnected')).toHaveLength(0)
  })

  it('still disconnects when token revocation fails', async () => {
    const { useCase, connectionRepo, oauth, events } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const connection = buildTestGoogleConnection({ status: 'active' })
    connectionRepo.seed([connection])

    // Make revocation throw — use case should still succeed
    ;(oauth as Record<string, unknown>).revokeToken = async () => {
      throw new Error('Google revocation endpoint unreachable')
    }

    const result = await useCase({ connectionId: connection.id as string }, ctx)

    expect(result.status).toBe('disconnected')

    const emitted = events.capturedByTag('google_account.disconnected')
    expect(emitted).toHaveLength(1)
  })
})
