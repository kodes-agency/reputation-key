// Integration context — disconnect Google account use case tests

import { describe, expect, it, vi } from 'vitest'
import { disconnectGoogleAccount } from './disconnect-google-account'
import { createInMemoryGoogleConnectionRepo } from '#/shared/testing/in-memory-google-connection-repo'
import { createSequentialIntegrationCommandStore } from '#/shared/testing/sequential-integration-command-store'
import { createInMemoryGoogleOAuthPort } from '#/shared/testing/in-memory-google-oauth-port'
import { createInMemoryTokenEncryption } from '#/shared/testing/in-memory-token-encryption'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { createMockLogger } from '#/shared/testing/mock-logger'
import {
  buildTestAuthContext,
  buildTestGoogleConnection,
} from '#/shared/testing/fixtures'
import { integrationError, isIntegrationError } from '../../domain/errors'
import type { GoogleDisconnectRevokeStore } from '../google-disconnect-revoke'
import { googleConnectionId, organizationId, reviewId } from '#/shared/domain/ids'
import { createInMemoryMyBusinessNotificationsPort } from '#/shared/testing/in-memory-mybusiness-notifications-port'
import { createGoogleNotificationAccountUsageReader } from '../google-notification-account-usage'
import { createGoogleNotificationProviderAuthorizer } from '../google-notification-provider-authorizer'
import { manageNotifications } from './manage-notifications'
import { createSourceContentPurge } from '#/contexts/review/infrastructure/source-content-purge'
import { createRunReviewSourceContentLifecycle } from '#/contexts/review/application/use-cases/run-source-content-lifecycle'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const setup = () => {
  const connectionRepo = createInMemoryGoogleConnectionRepo()
  const oauth = createInMemoryGoogleOAuthPort()
  const encryption = createInMemoryTokenEncryption()
  const outbox = createRecordedOutbox()
  const baseDeps = {
    connectionRepo,
    oauth,
    encryption,
    commandStore: createSequentialIntegrationCommandStore({
      connectionRepo,
      outbox,
      clock: () => FIXED_TIME,
    }),
    clock: () => FIXED_TIME,
    logger: createMockLogger(),
  }
  return {
    useCase: disconnectGoogleAccount(baseDeps),
    baseDeps,
    connectionRepo,
    oauth,
    encryption,
    outbox,
  }
}

describe('disconnectGoogleAccount', () => {
  it('keeps a shared account subscribed until the last organization disconnects', async () => {
    const { baseDeps, connectionRepo, outbox } = setup()
    const first = buildTestAuthContext({ role: 'AccountAdmin' })
    const second = buildTestAuthContext({
      role: 'AccountAdmin',
      organizationId: organizationId('org-second'),
    })
    const connectionA = buildTestGoogleConnection({
      organizationId: first.organizationId,
    })
    const connectionB = buildTestGoogleConnection({
      organizationId: second.organizationId,
      id: googleConnectionId('e0000000-0000-0000-0000-000000000002'),
    })
    connectionRepo.seed([connectionA, connectionB])
    const gbpAccountId = 'repkey-synthetic-do-not-use-account-0001'
    const bindingReads = {
      findLinkedPropertyIds: async () => ['10000000-0000-4000-8000-000000000001'],
      readBinding: async (org: typeof first.organizationId) => ({
        connectionId: org === first.organizationId ? connectionA.id : connectionB.id,
        accountId: gbpAccountId,
        state: 'active',
        lifecycleState: 'active',
        deletedAt: null,
        sourceEpoch: 1,
      }),
    }
    const notifications = createInMemoryMyBusinessNotificationsPort()
    const management = manageNotifications({
      accounts: {
        withAccount: async (_account, run) => run(),
        read: async () => null,
        attempted: async () => undefined,
        verified: async () => undefined,
        invalidate: async () => undefined,
      },
      nowMs: () => 0,
      authorizeProviderCall: createGoogleNotificationProviderAuthorizer({
        ...bindingReads,
        findConnection: connectionRepo.findById,
        authorizeSystemCall: async (input) => ({
          ok: true,
          accessToken: 'access-token',
          authorization: {
            capability: 'property.connect_gbp',
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            connectionId: input.connectionId,
            initiatorUserId: null,
            expectedCredentialGeneration: 1,
            authorizationVector: { propertySourceEpoch: input.sourceEpoch },
          },
        }),
      }),
      hasOtherActiveAccountBinding: createGoogleNotificationAccountUsageReader({
        ...bindingReads,
        listOrganizations: connectionRepo.listOrganizationIdsWithActiveConnections,
        listConnections: (org) =>
          connectionRepo.listByOrganization(org, { showAll: true }),
      }),
      notifications,
      pubsubTopic: 'projects/test/topics/gbp-reviews',
      notificationTypes: ['NEW_REVIEW'],
      logger: baseDeps.logger,
    })
    const disconnect = disconnectGoogleAccount({
      ...baseDeps,
      unsubscribeFromNotifications: management.unsubscribe,
    })

    await expect(
      disconnect({ connectionId: connectionA.id }, first),
    ).resolves.toMatchObject({
      status: 'disconnected',
      encryptedRefreshToken: 'redacted',
    })
    expect(notifications.unsubscribeCalls).toEqual([])
    await expect(
      disconnect({ connectionId: connectionB.id }, second),
    ).resolves.toMatchObject({
      status: 'disconnected',
      encryptedRefreshToken: 'redacted',
    })
    expect(notifications.unsubscribeCalls).toHaveLength(1)
    expect(notifications.unsubscribeCalls[0]).toMatchObject({
      gbpAccountId,
      authorization: {
        organizationId: second.organizationId,
        connectionId: connectionB.id,
      },
    })
    expect(outbox.byTag('integration.google_account.disconnected')).toHaveLength(2)
  })

  it('redacts the signed identity and secrets, purges source content, and records a fact', async () => {
    const { baseDeps, connectionRepo, outbox } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const connection = buildTestGoogleConnection({ status: 'active' })
    connectionRepo.seed([connection])
    const forConnection = vi.fn(async () => ({
      subject: 'reviews.purge.connection',
      batches: 1,
      rowsDeleted: 0,
      rowsRedacted: 3,
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
    expect(outbox.byTag('integration.google_account.disconnected')[0]).toMatchObject({
      connectionId: connection.id,
      organizationId: ctx.organizationId,
    })
  })

  it('rejects users without integration.manage permission', async () => {
    const { useCase } = setup()
    await expect(
      useCase({ connectionId: 'any-id' }, buildTestAuthContext({ role: 'Member' })),
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

  it('returns an already-disconnected connection without another fact', async () => {
    const { useCase, connectionRepo, outbox } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const connection = buildTestGoogleConnection({ status: 'disconnected' })
    connectionRepo.seed([connection])

    await expect(useCase({ connectionId: connection.id as string }, ctx)).resolves.toBe(
      connection,
    )
    expect(outbox.byTag('integration.google_account.disconnected')).toHaveLength(0)
  })

  it('keeps the original content deadline through repeated disconnect inspections', async () => {
    const { baseDeps, connectionRepo, outbox } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const connection = buildTestGoogleConnection({
      id: 'b8000000-0000-4000-8000-000000000002',
      status: 'active',
    })
    connectionRepo.seed([connection])
    let now = FIXED_TIME
    const rows = [
      {
        reviewId: reviewId('b8000000-0000-4000-8000-000000000001'),
        createdAt: new Date('2026-04-01T12:00:00Z'),
        sourceContentState: 'active' as const,
        lifecycleClock: new Date('2026-05-01T12:00:00Z'),
        shadowFindings: [],
      },
    ]
    const original = structuredClone(rows)
    const store = {
      readInspectionBatch: vi.fn(async () => rows),
      applyLifecycleBatch: vi.fn(),
    }
    const runLifecycle = vi.fn(
      createRunReviewSourceContentLifecycle({
        store,
        clock: () => now,
      }),
    )
    const command = disconnectGoogleAccount({
      ...baseDeps,
      clock: () => now,
      sourceContentPurge: createSourceContentPurge({
        db: {} as never,
        clock: () => now,
        runLifecycle,
      }),
    })

    await command({ connectionId: connection.id }, ctx)
    now = new Date('2026-04-30T12:00:00Z')
    await command({ connectionId: connection.id }, ctx)

    expect(rows).toEqual(original)
    expect(store.readInspectionBatch).toHaveBeenCalledTimes(2)
    expect(store.applyLifecycleBatch).not.toHaveBeenCalled()
    expect(runLifecycle).toHaveBeenCalledTimes(2)
    for (const result of runLifecycle.mock.results) {
      await expect(result.value).resolves.toMatchObject({
        mode: 'report',
        lifecycle: { eligible: 1, expired: 0 },
        apply: { enabled: false },
      })
    }
    expect(outbox.byTag('integration.google_account.disconnected')).toHaveLength(1)
  })

  it('retries local cleanup and an interrupted source purge without repeating provider cleanup', async () => {
    const { baseDeps, connectionRepo, outbox } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const connection = buildTestGoogleConnection({ status: 'active' })
    connectionRepo.seed([connection])
    const cleanup = vi.spyOn(baseDeps.commandStore, 'disconnectGoogleAccount')
    const unsubscribe = vi.fn()
    const forConnection = vi.fn().mockRejectedValueOnce(new Error('purge interrupted'))
    const command = disconnectGoogleAccount({
      ...baseDeps,
      unsubscribeFromNotifications: unsubscribe,
      sourceContentPurge: {
        forConnection,
        forProperty: vi.fn(),
        forOrganization: vi.fn(),
        inboxForProperty: vi.fn(),
      },
    })

    await expect(command({ connectionId: connection.id }, ctx)).rejects.toThrow(
      'purge interrupted',
    )
    await expect(command({ connectionId: connection.id }, ctx)).resolves.toMatchObject({
      status: 'disconnected',
    })
    expect(cleanup).toHaveBeenCalledTimes(2)
    expect(forConnection).toHaveBeenCalledTimes(2)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(outbox.byTag('integration.google_account.disconnected')).toHaveLength(1)
  })

  it('returns the connection an overlapping disconnect committed first, without a second fact', async () => {
    const { baseDeps, connectionRepo, outbox } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const connection = buildTestGoogleConnection({ status: 'active' })
    connectionRepo.seed([connection])
    const overlapping = disconnectGoogleAccount(baseDeps)
    const useCase = disconnectGoogleAccount({
      ...baseDeps,
      // The other request reads, commits and records its fact while this one
      // is still unsubscribing, after both saw the connection active.
      unsubscribeFromNotifications: async () => {
        await overlapping({ connectionId: connection.id as string }, ctx)
      },
    })

    await expect(
      useCase({ connectionId: connection.id as string }, ctx),
    ).resolves.toMatchObject({
      status: 'disconnected',
      encryptedRefreshToken: 'redacted',
    })
    expect(outbox.byTag('integration.google_account.disconnected')).toHaveLength(1)
  })

  it('leaves a reconnect that commits before a disconnected retry locked read intact', async () => {
    const { baseDeps, connectionRepo, outbox } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const disconnected = buildTestGoogleConnection({ status: 'disconnected' })
    connectionRepo.seed([disconnected])
    const forConnection = vi.fn()
    const disconnect = baseDeps.commandStore.disconnectGoogleAccount
    const command = disconnectGoogleAccount({
      ...baseDeps,
      commandStore: {
        ...baseDeps.commandStore,
        disconnectGoogleAccount: async (input) => {
          await baseDeps.commandStore.reconnectGoogleAccount({
            organizationId: ctx.organizationId,
            connectionId: disconnected.id,
            expected: disconnected,
            googleSubject: 'reconnected-subject',
            googleAccountEmail: null,
            encryptedAccessToken: 'enc:new-access',
            encryptedRefreshToken: 'enc:new-refresh',
            tokenExpiresAt: new Date(FIXED_TIME.getTime() + 3_600_000),
            scopes: ['https://www.googleapis.com/auth/business.manage'],
            visibility: 'organization',
            event: {
              ...input.event,
              _tag: 'integration.google_account.connected',
              userId: ctx.userId,
            },
          })
          return disconnect(input)
        },
      },
      sourceContentPurge: {
        forConnection,
        forProperty: vi.fn(),
        forOrganization: vi.fn(),
        inboxForProperty: vi.fn(),
      },
    })

    await expect(command({ connectionId: disconnected.id }, ctx)).rejects.toMatchObject({
      code: 'invalid_transition',
    })
    await expect(
      connectionRepo.findById(ctx.organizationId, disconnected.id),
    ).resolves.toMatchObject({
      status: 'active',
      encryptedRefreshToken: 'enc:new-refresh',
    })
    expect(forConnection).not.toHaveBeenCalled()
    expect(outbox.byTag('integration.google_account.disconnected')).toHaveLength(0)
  })

  it('still disconnects when a token refresh commits between its read and its write', async () => {
    const { baseDeps, connectionRepo, outbox } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const connection = buildTestGoogleConnection({ status: 'active' })
    connectionRepo.seed([connection])
    const useCase = disconnectGoogleAccount({
      ...baseDeps,
      // A background refresh rotates the credential after the disconnect read
      // it. The disconnect is not fenced on the generation it read: it wins.
      unsubscribeFromNotifications: async () => {
        await connectionRepo.updateTokens(
          ctx.organizationId,
          connection.id,
          {
            lifecycleVersion: connection.lifecycleVersion,
            credentialGeneration: connection.credentialGeneration,
          },
          'enc:access-token-2',
          'enc:refresh-token-2',
          new Date('2026-12-31T23:59:59Z'),
        )
      },
    })

    await expect(
      useCase({ connectionId: connection.id as string }, ctx),
    ).resolves.toMatchObject({
      status: 'disconnected',
      encryptedAccessToken: 'redacted',
      encryptedRefreshToken: 'redacted',
    })
    expect(outbox.byTag('integration.google_account.disconnected')).toHaveLength(1)
  })

  it('leaves a disconnect in flight to its governed attempt and records nothing', async () => {
    const { useCase, connectionRepo, outbox } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const inFlight = buildTestGoogleConnection({
      status: 'disconnecting',
      credentialUseState: 'cleanup_only',
      cleanupMaterialDeadlineAt: new Date(FIXED_TIME.getTime() + 30_000),
      lifecycleVersion: 2,
    })
    connectionRepo.seed([inFlight])

    await expect(useCase({ connectionId: inFlight.id as string }, ctx)).rejects.toSatisfy(
      (error: unknown) =>
        isIntegrationError(error) &&
        (error as { code: string }).code === 'invalid_transition',
    )
    // The governed attempt still owns the row, so its settle can redact it.
    await expect(connectionRepo.findById(ctx.organizationId, inFlight.id)).resolves.toBe(
      inFlight,
    )
    expect(outbox.byTag('integration.google_account.disconnected')).toHaveLength(0)
  })

  it('finishes a disconnecting connection locally once its cleanup window has closed', async () => {
    const { useCase, connectionRepo, outbox } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const stranded = buildTestGoogleConnection({
      status: 'disconnecting',
      credentialUseState: 'cleanup_only',
      cleanupMaterialDeadlineAt: new Date(FIXED_TIME.getTime() - 1),
      lifecycleVersion: 2,
    })
    connectionRepo.seed([stranded])

    await expect(
      useCase({ connectionId: stranded.id as string }, ctx),
    ).resolves.toMatchObject({
      status: 'disconnected',
      credentialUseState: 'none',
      encryptedRefreshToken: 'redacted',
      cleanupMaterialDeadlineAt: null,
    })
    expect(outbox.byTag('integration.google_account.disconnected')).toHaveLength(1)
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

  it('unsubscribes but never falls back to an undurable direct revoke', async () => {
    const { baseDeps, connectionRepo, oauth, outbox } = setup()
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
    expect(order).toEqual(['unsubscribe'])
    expect(outbox.byTag('integration.google_account.disconnected')).toHaveLength(1)
  })

  it('binds a durable revoke attempt to the current AccountAdmin and exact connection', async () => {
    const { baseDeps, connectionRepo, oauth } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const connection = buildTestGoogleConnection({ status: 'active' })
    connectionRepo.seed([connection])
    const authorizeProviderCall = vi.fn(async (input) => ({
      capability: 'property.import_gbp_v2' as const,
      organizationId: ctx.organizationId,
      propertyId: null,
      connectionId: connection.id,
      initiatorUserId: ctx.userId,
      expectedCredentialGeneration: connection.credentialGeneration,
      authorizationVector: {
        connectionLifecycleVersion: connection.lifecycleVersion,
        connectionAccessVersion: connection.accessVersion,
        credentialGeneration: connection.credentialGeneration,
      },
      disconnectRevoke: {
        attemptId: input.disconnectRevoke!.attemptId,
        cleanupDeadlineAtMs: input.disconnectRevoke!.cleanupDeadlineAt.getTime(),
      },
    }))
    const revokeTokenWithOutcome = vi.fn(async () => 'cleanup_ambiguous' as const)
    ;(oauth as Record<string, unknown>).revokeTokenWithOutcome = revokeTokenWithOutcome
    const settle = vi.fn(async () => ({
      ok: true as const,
      value: {
        ...connection,
        status: 'disconnected' as const,
        credentialUseState: 'none' as const,
        encryptedAccessToken: 'redacted',
        encryptedRefreshToken: 'redacted',
        googleSubject: null,
        scopes: [],
      },
    }))
    const useCase = disconnectGoogleAccount({
      ...baseDeps,
      authorizeProviderCall,
      disconnectRevokeStore: {
        prepare: vi.fn(),
        acquireDispatch: vi.fn(),
        settle,
        reconcileElapsed: vi.fn(),
      },
      idGen: () => '70000000-0000-4000-8000-000000000001',
    })

    await useCase({ connectionId: connection.id }, ctx)

    expect(authorizeProviderCall).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'oauth.revoke',
        organizationId: ctx.organizationId,
        connectionId: connection.id,
        initiatorUserId: ctx.userId,
        disconnectRevoke: {
          attemptId: '70000000-0000-4000-8000-000000000001',
          cleanupDeadlineAt: new Date(FIXED_TIME.getTime() + 60_000),
        },
      }),
    )
    expect(revokeTokenWithOutcome).toHaveBeenCalledWith(
      'refresh-token',
      expect.objectContaining({
        disconnectRevoke: {
          attemptId: '70000000-0000-4000-8000-000000000001',
          cleanupDeadlineAtMs: FIXED_TIME.getTime() + 60_000,
        },
      }),
    )
    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: '70000000-0000-4000-8000-000000000001',
        outcome: 'cleanup_ambiguous',
      }),
    )
  })

  // The governed path binds one durable cleanup attempt to one permit; every
  // refusal that happens before that attempt exists leaves nothing for recovery
  // to find, so none of them may be reported as "completed by recovery".
  describe('when governed cleanup cannot start or cannot read the token', () => {
    const governed = (
      over: Readonly<{
        decrypt?: () => string
        settle?: GoogleDisconnectRevokeStore['settle']
      }> = {},
    ) => {
      const fixture = setup()
      const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
      const connection = buildTestGoogleConnection({ status: 'active' })
      fixture.connectionRepo.seed([connection])
      const revokeTokenWithOutcome = vi.fn(async () => 'confirmed_not_sent' as const)
      ;(fixture.oauth as Record<string, unknown>).revokeTokenWithOutcome =
        revokeTokenWithOutcome
      const settle = vi.fn<GoogleDisconnectRevokeStore['settle']>(
        over.settle ?? (async () => ({ ok: false, code: 'not_found' })),
      )
      const useCase = disconnectGoogleAccount({
        ...fixture.baseDeps,
        encryption: {
          ...fixture.baseDeps.encryption,
          ...(over.decrypt ? { decrypt: over.decrypt } : {}),
        },
        authorizeProviderCall: vi.fn(async (input) => ({
          capability: 'property.import_gbp_v2' as const,
          organizationId: ctx.organizationId,
          propertyId: null,
          connectionId: connection.id,
          initiatorUserId: ctx.userId,
          expectedCredentialGeneration: connection.credentialGeneration,
          authorizationVector: {},
          disconnectRevoke: {
            attemptId: input.disconnectRevoke!.attemptId,
            cleanupDeadlineAtMs: input.disconnectRevoke!.cleanupDeadlineAt.getTime(),
          },
        })),
        disconnectRevokeStore: {
          prepare: vi.fn(),
          acquireDispatch: vi.fn(),
          settle,
          reconcileElapsed: vi.fn(),
        },
        idGen: () => '70000000-0000-4000-8000-000000000002',
      })
      return { ...fixture, ctx, connection, useCase, revokeTokenWithOutcome, settle }
    }

    it('disconnects locally when the stored refresh token cannot be decrypted', async () => {
      const { useCase, ctx, connection, connectionRepo, outbox, revokeTokenWithOutcome } =
        governed({
          decrypt: () => {
            throw integrationError('encryption_error', 'Unknown key version')
          },
        })

      await expect(
        useCase({ connectionId: connection.id as string }, ctx),
      ).resolves.toMatchObject({
        status: 'disconnected',
        encryptedRefreshToken: 'redacted',
      })

      expect(revokeTokenWithOutcome).not.toHaveBeenCalled()
      await expect(
        connectionRepo.findById(ctx.organizationId, connection.id),
      ).resolves.toMatchObject({ status: 'disconnected' })
      expect(outbox.byTag('integration.google_account.disconnected')).toHaveLength(1)
    })

    // `prepare` refused (a concurrent attempt, versions that moved after the
    // authorizer read them), so no attempt row exists and `settle` finds none.
    // Nothing was sent and no recovery will visit the connection: the local
    // disconnect, which itself refuses while another attempt's window is open,
    // finishes the request.
    it('disconnects locally when the attempt was never prepared', async () => {
      const { useCase, ctx, connection, connectionRepo, outbox, settle } = governed()

      await expect(
        useCase({ connectionId: connection.id as string }, ctx),
      ).resolves.toMatchObject({
        status: 'disconnected',
        encryptedRefreshToken: 'redacted',
      })

      expect(settle).toHaveBeenCalledOnce()
      await expect(
        connectionRepo.findById(ctx.organizationId, connection.id),
      ).resolves.toMatchObject({ status: 'disconnected' })
      expect(outbox.byTag('integration.google_account.disconnected')).toHaveLength(1)
    })

    it('still reports recovery for an attempt that exists but could not settle', async () => {
      const { useCase, ctx, connection, connectionRepo, outbox } = governed({
        settle: async () => ({ ok: false, code: 'concurrent_attempt' }),
      })

      await expect(
        useCase({ connectionId: connection.id as string }, ctx),
      ).rejects.toThrow('Google disconnect cleanup will be completed by recovery')

      await expect(
        connectionRepo.findById(ctx.organizationId, connection.id),
      ).resolves.toMatchObject({ status: 'active' })
      expect(outbox.byTag('integration.google_account.disconnected')).toHaveLength(0)
    })
  })
})
