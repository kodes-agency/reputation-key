// Integration context — disconnect Google account use case tests

import { describe, expect, it, vi } from 'vitest'
import { disconnectGoogleAccount } from './disconnect-google-account'
import { createInMemoryGoogleConnectionRepo } from '#/shared/testing/in-memory-google-connection-repo'
import { createSequentialIntegrationCommandStore } from '#/shared/testing/sequential-integration-command-store'
import { createInMemoryGoogleOAuthPort } from '#/shared/testing/in-memory-google-oauth-port'
import { createInMemoryTokenEncryption } from '#/shared/testing/in-memory-token-encryption'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createMockLogger } from '#/shared/testing/mock-logger'
import {
  buildTestAuthContext,
  buildTestGoogleConnection,
} from '#/shared/testing/fixtures'
import { isIntegrationError } from '../../domain/errors'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const setup = () => {
  const connectionRepo = createInMemoryGoogleConnectionRepo()
  const oauth = createInMemoryGoogleOAuthPort()
  const encryption = createInMemoryTokenEncryption()
  const events = createCapturingEventBus()
  const baseDeps = {
    connectionRepo,
    oauth,
    encryption,
    commandStore: createSequentialIntegrationCommandStore({ connectionRepo, events }),
    clock: () => FIXED_TIME,
    logger: createMockLogger(),
  }
  return {
    useCase: disconnectGoogleAccount(baseDeps),
    baseDeps,
    connectionRepo,
    oauth,
    events,
  }
}

describe('disconnectGoogleAccount', () => {
  it('redacts the signed identity and secrets, purges source content, and records a fact', async () => {
    const { baseDeps, connectionRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const connection = buildTestGoogleConnection({ status: 'active' })
    connectionRepo.seed([connection])
    const forConnection = vi.fn(async () => ({
      subject: 'reviews.purge.connection',
      batches: 1,
      rowsDeleted: 3,
    }))
    const useCase = disconnectGoogleAccount({
      ...baseDeps,
      sourceContentPurge: {
        forConnection,
        forProperty: vi.fn(),
        forOrganization: vi.fn(),
        inboxForProperty: vi.fn(),
      },
    })

    const result = await useCase({ connectionId: connection.id as string }, ctx)

    expect(result.status).toBe('disconnected')
    expect(forConnection).toHaveBeenCalledWith(ctx.organizationId, connection.id)
    await expect(
      connectionRepo.findById(ctx.organizationId, connection.id),
    ).resolves.toMatchObject({
      status: 'disconnected',
      googleSubject: null,
      encryptedAccessToken: 'redacted',
      encryptedRefreshToken: 'redacted',
      scopes: [],
      credentialUseState: 'none',
    })
    expect(
      events.capturedByTag('integration.google_account.disconnected')[0],
    ).toMatchObject({
      connectionId: connection.id,
      organizationId: ctx.organizationId,
    })
  })

  it('rejects users without integration.manage permission', async () => {
    const { useCase } = setup()
    await expect(
      useCase({ connectionId: 'any-id' }, buildTestAuthContext({ role: 'Staff' })),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) && (error as { code: string }).code === 'forbidden',
    )
  })

  it('rejects an unknown tenant-scoped connection', async () => {
    const { useCase } = setup()
    await expect(
      useCase(
        { connectionId: 'nonexistent-0000-0000-0000-000000000001' },
        buildTestAuthContext({ role: 'AccountAdmin' }),
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) &&
        (error as { code: string }).code === 'connection_not_found',
    )
  })

  it('returns an already-disconnected connection without another event', async () => {
    const { useCase, connectionRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const connection = buildTestGoogleConnection({ status: 'disconnected' })
    connectionRepo.seed([connection])

    await expect(useCase({ connectionId: connection.id as string }, ctx)).resolves.toBe(
      connection,
    )
    expect(events.capturedByTag('integration.google_account.disconnected')).toHaveLength(
      0,
    )
  })

  it('fails closed on import cancellation before provider or connection mutation', async () => {
    const { baseDeps, connectionRepo, oauth } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const connection = buildTestGoogleConnection({ status: 'active' })
    connectionRepo.seed([connection])
    const cancelGoogleImportsForConnection = vi.fn(async () => {
      throw new Error('import lifecycle unavailable')
    })
    const useCase = disconnectGoogleAccount({
      ...baseDeps,
      cancelGoogleImportsForConnection,
    })

    await expect(useCase({ connectionId: connection.id as string }, ctx)).rejects.toThrow(
      'import lifecycle unavailable',
    )
    expect(cancelGoogleImportsForConnection).toHaveBeenCalledWith(
      ctx.organizationId,
      connection.id,
    )
    expect(oauth.revokeTokenCalls()).toEqual([])
    await expect(
      connectionRepo.findById(ctx.organizationId, connection.id),
    ).resolves.toMatchObject({
      status: 'active',
    })
  })

  it('unsubscribes before revocation and still disconnects if revocation fails', async () => {
    const { baseDeps, connectionRepo, oauth, events } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const connection = buildTestGoogleConnection({ status: 'active' })
    connectionRepo.seed([connection])
    const order: string[] = []
    ;(oauth as Record<string, unknown>).revokeToken = async () => {
      order.push('revoke')
      throw new Error('Google revocation endpoint unreachable')
    }
    const useCase = disconnectGoogleAccount({
      ...baseDeps,
      unsubscribeFromNotifications: async () => {
        order.push('unsubscribe')
      },
    })

    await expect(
      useCase({ connectionId: connection.id as string }, ctx),
    ).resolves.toMatchObject({ status: 'disconnected' })
    expect(order).toEqual(['unsubscribe', 'revoke'])
    expect(events.capturedByTag('integration.google_account.disconnected')).toHaveLength(
      1,
    )
  })
})
