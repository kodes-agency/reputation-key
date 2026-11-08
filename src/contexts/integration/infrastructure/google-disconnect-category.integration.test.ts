import { replyScopeEffects } from '#/contexts/reputation/application/public-api'
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  googleConnections,
  idempotencyReceipts,
  outboxEvents,
  properties,
} from '#/shared/db/schema'
import { googleConnectionId, organizationId, userId } from '#/shared/domain/ids'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { createInMemoryGoogleOAuthPort } from '#/shared/testing/in-memory-google-oauth-port'
import { createInMemoryTokenEncryption } from '#/shared/testing/in-memory-token-encryption'
import { createPropertyGoogleBindingStore } from '#/contexts/property/infrastructure/property-google-binding-store'
import { connectGoogleAccount } from '../application/use-cases/connect-google-account'
import { disconnectGoogleAccount } from '../application/use-cases/disconnect-google-account'
import { createRefreshBoundGoogleCategories } from '../application/refresh-bound-google-categories'
import { createGoogleBusinessInformationAdapter } from './adapters/google-business-information.adapter'
import { createGoogleConnectionRepository } from './repositories/google-connection.repository'
import { createGoogleOAuthExchangeRecoveryRepository } from './repositories/google-oauth-exchange-recovery.repository'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  integrationGoogleAccountDisconnected,
  integrationGoogleAccountReauthorizationRequired,
} from '../domain/events'
import { createAtomicIntegrationCommandStore } from './integration-command-store'
import { createGoogleDisconnectRevokeRepository } from './repositories/google-disconnect-revoke.repository'
import { createConsumerRegistry } from '#/shared/outbox'
import { buildConsumerEvent } from '#/shared/outbox/envelope'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { registerGoogleCategoryRefreshConsumer } from './google-category-refresh-outbox-consumers'

const ORG = organizationId('account-disconnect-category-org')
const OTHER_ORG = organizationId('account-disconnect-category-other-org')
const CONNECTION = googleConnectionId('7a000000-0000-4000-8000-000000000001')
const SIBLING_CONNECTION = googleConnectionId('7a000000-0000-4000-8000-000000000002')
const OTHER_CONNECTION = googleConnectionId('7a000000-0000-4000-8000-000000000003')
const ACTOR = userId('account-disconnect-category-actor')
const ATTEMPT = '7a000000-0000-4000-8000-000000000004'
const NOW = new Date('2026-11-06T10:00:00Z')
const OAUTH_ATTEMPT = '7a000000-0000-4000-8000-000000000005'
const db = getDb()
const store = createAtomicIntegrationCommandStore(db, () => NOW)
const revoke = createGoogleDisconnectRevokeRepository(db)
const event = () =>
  integrationGoogleAccountDisconnected({
    organizationId: ORG,
    connectionId: CONNECTION,
    userId: ACTOR,
    occurredAt: NOW,
  })

async function cleanup() {
  await db.delete(properties).where(inArray(properties.organizationId, [ORG, OTHER_ORG]))
  await db
    .delete(googleConnections)
    .where(inArray(googleConnections.organizationId, [ORG, OTHER_ORG]))
  await db
    .delete(outboxEvents)
    .where(inArray(outboxEvents.organizationId, [ORG, OTHER_ORG]))
  await db
    .delete(idempotencyReceipts)
    .where(
      and(
        inArray(idempotencyReceipts.scope, [
          'google_disconnect_revoke',
          'google_oauth_exchange',
        ]),
        inArray(idempotencyReceipts.key, [ATTEMPT, OAUTH_ATTEMPT]),
      ),
    )
}

async function hints() {
  return db
    .select({
      connectionId: properties.googleConnectionId,
      category: properties.googlePrimaryCategory,
      readAt: properties.googlePrimaryCategoryUpdatedAt,
    })
    .from(properties)
    .where(inArray(properties.organizationId, [ORG, OTHER_ORG]))
    .orderBy(properties.id)
}

async function seedAttempt() {
  await db.insert(idempotencyReceipts).values({
    scope: 'google_disconnect_revoke',
    key: ATTEMPT,
    recordedAt: NOW,
    payload: {
      id: ATTEMPT,
      organizationId: ORG,
      connectionId: CONNECTION,
      initiatorUserId: ACTOR,
      cleanupWorkPermitId: null,
      state: 'active',
      expectedLifecycleVersion: 1,
      expectedAccessVersion: 1,
      expectedCredentialGeneration: 1,
      credentialBinding: null,
      cleanupDeadlineAt: new Date(NOW.getTime() - 1).toISOString(),
      activatedAt: new Date(NOW.getTime() - 60_000).toISOString(),
      dispatchingAt: null,
      terminalAt: null,
      outcomeCode: null,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    },
  })
}

async function disconnect(operation: 'local' | 'governed', disconnectEvent = event()) {
  if (operation === 'local')
    return store.disconnectGoogleAccount({
      organizationId: ORG,
      connectionId: CONNECTION,
      event: disconnectEvent,
    })
  await seedAttempt()
  return revoke.settle({
    attemptId: ATTEMPT,
    organizationId: ORG,
    connectionId: CONNECTION,
    initiatorUserId: ACTOR,
    outcome: 'confirmed_not_sent',
    outcomeCode: 'provider_dispatch_not_started',
    event: disconnectEvent,
    now: NOW,
  })
}

function reconnect(
  readProvider: () => Promise<unknown>,
  afterPublishAuthorization?: () => Promise<unknown>,
) {
  const connectionRepo = createGoogleConnectionRepository(db, () => NOW)
  const provider = createInMemoryGoogleOAuthPort()
  const encryption = createInMemoryTokenEncryption()
  const refresh = createRefreshBoundGoogleCategories({
    findPropertyIds: async (connectionId, tenant) =>
      (
        await db
          .select({ id: properties.id })
          .from(properties)
          .where(
            and(
              eq(properties.organizationId, tenant),
              eq(properties.googleConnectionId, connectionId),
            ),
          )
      ).map((row) => row.id),
    binding: createPropertyGoogleBindingStore(db, replyScopeEffects),
    authorize: async ({ actor, connectionId, phase }) => {
      const connection = await connectionRepo.findById(actor.organizationId, connectionId)
      if (!connection || connection.status !== 'active')
        return { ok: false, code: 'connection_unavailable' }
      if (phase === 'publish') await afterPublishAuthorization?.()
      return {
        ok: true,
        accessToken: 'synthetic-access',
        authorization: {
          organizationId: actor.organizationId,
          userId: actor.userId,
          connectionId,
          connectionLifecycleVersion: connection.lifecycleVersion,
          connectionAccessVersion: connection.accessVersion,
          credentialGeneration: connection.credentialGeneration,
          authorizationVector: {},
        },
      }
    },
    locations: createGoogleBusinessInformationAdapter({
      executor: {
        execute: async () => ({
          ok: true,
          status: 200,
          headers: {
            contentType: 'application/json',
            cacheControl: null,
            retryAfter: null,
          },
          body: new TextEncoder().encode(JSON.stringify(await readProvider())),
        }),
      },
      nowMs: () => NOW.getTime(),
    }),
    clock: () => NOW,
  })
  const command = connectGoogleAccount({
    connectionRepo,
    commandStore: store,
    encryption,
    oauth: {
      ...provider,
      exchangeCode: async (input) => {
        const result = await provider.exchangeCode(input)
        await input.preserveSuccessfulResult?.({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresIn: result.expiresIn,
          scopes: result.scopes,
          idToken: 'synthetic-id-token',
        })
        return result
      },
    },
    exchangeRecovery: createGoogleOAuthExchangeRecoveryRepository(db),
    clock: () => NOW,
    idGen: () => OAUTH_ATTEMPT,
    callbackUrl: 'http://localhost:3000/api/auth/google/callback',
  })
  const actor = buildTestAuthContext({
    organizationId: ORG,
    userId: ACTOR,
    role: 'AccountAdmin',
  })
  const run = async () => {
    return command(
      {
        exchangeAttemptId: OAUTH_ATTEMPT,
        code: 'synthetic-code',
        visibility: 'organization',
        purpose: 'reviews',
        connectionMode: 'reconnect',
        targetConnectionId: CONNECTION,
        verifierMaterial: {
          contractVersion: 'v2',
          codeVerifier: 'synthetic-verifier',
          oidcNonce: 'n'.repeat(43),
        },
      },
      actor,
    )
  }
  const registry = createConsumerRegistry()
  registerGoogleCategoryRefreshConsumer(registry, {
    findConnection: connectionRepo.findById,
    resolveActor: async () => actor,
    refresh,
    receipts: createOutboxRepository(db),
  })
  const deliver = async () => {
    const [row] = await db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.organizationId, ORG),
          eq(outboxEvents.eventType, 'integration.google_account.connected'),
        ),
      )
      .limit(1)
    const consumer = registry.listFor('integration.google_account.connected')[0]
    if (!row || !consumer) throw new Error('Connection fact or category consumer missing')
    return consumer.handler(buildConsumerEvent({ ...row, recordedAt: row.createdAt }))
  }
  return {
    run,
    deliver,
    runAndRefresh: async () => {
      const connection = await run()
      await deliver()
      return connection
    },
    resume: () => command.resume({ attemptId: OAUTH_ATTEMPT }, actor),
  }
}

const providerCategory = (category: string | null) => ({
  locations: [
    {
      name: 'locations/location-0',
      title: 'Synthetic location',
      ...(category ? { categories: { primaryCategory: { displayName: category } } } : {}),
    },
  ],
})

beforeAll(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})
beforeEach(async () => {
  await cleanup()
  for (const [index, connectionId] of [
    CONNECTION,
    SIBLING_CONNECTION,
    OTHER_CONNECTION,
  ].entries()) {
    const tenant = index === 2 ? OTHER_ORG : ORG
    await db.insert(googleConnections).values({
      id: connectionId,
      organizationId: tenant,
      googleSubject: `disconnect-category-${index}`,
      encryptedAccessToken: 'synthetic-access',
      encryptedRefreshToken: 'synthetic-refresh',
      tokenExpiresAt: new Date(NOW.getTime() + 60_000),
      scopes: ['synthetic-scope'],
      connectedBy: ACTOR,
    })
    await db.insert(properties).values({
      id: `7a100000-0000-4000-8000-00000000000${index + 1}`,
      organizationId: tenant,
      name: `Synthetic ${index}`,
      slug: `disconnect-category-${index}`,
      timezone: 'Europe/Sofia',
      googleConnectionId: connectionId,
      googleBindingState: 'active',
      gbpAccountId: 'account',
      gbpLocationId: `location-${index}`,
      googlePrimaryCategory: ['Hotel', 'Day spa', 'Restaurant'][index],
      googlePrimaryCategoryUpdatedAt: NOW,
    })
  }
})
afterAll(async () => {
  await cleanup()
  clearEventSchemas()
})

describe('Google account category cleanup (PostgreSQL)', () => {
  it('restores only the reconnected account categories from a fresh Google read', async () => {
    await disconnect('local')
    const read = vi.fn(async () => providerCategory('  Restaurant  '))
    const before = await db
      .select()
      .from(properties)
      .where(eq(properties.googleConnectionId, CONNECTION))
    const command = reconnect(read)
    expect(await command.run()).toMatchObject({
      id: CONNECTION,
      status: 'active',
    })
    expect(read).not.toHaveBeenCalled()
    await command.deliver()
    expect(read).toHaveBeenCalledOnce()
    expect(await hints()).toEqual([
      { connectionId: CONNECTION, category: 'Restaurant', readAt: NOW },
      { connectionId: SIBLING_CONNECTION, category: 'Day spa', readAt: NOW },
      { connectionId: OTHER_CONNECTION, category: 'Restaurant', readAt: NOW },
    ])
    const after = await db
      .select()
      .from(properties)
      .where(eq(properties.googleConnectionId, CONNECTION))
    expect(after).toEqual(
      before.map((row) => ({
        ...row,
        googlePrimaryCategory: 'Restaurant',
        googlePrimaryCategoryUpdatedAt: NOW,
        googlePrimaryCategoryRefreshEventId: expect.any(String),
      })),
    )
  })

  it('retries a failed fresh read from the durable fact while the completed callback stays successful', async () => {
    await disconnect('local')
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValue(providerCategory('Day spa'))
    const command = reconnect(read)
    await expect(command.run()).resolves.toMatchObject({ status: 'active' })
    expect(read).not.toHaveBeenCalled()
    await expect(command.deliver()).rejects.toMatchObject({
      _tag: 'GbpApiError',
      code: 'upstream_error',
      dispatch: 'unknown',
    })
    expect((await hints())[0]?.category).toBeNull()
    await command.resume()
    expect(read).toHaveBeenCalledTimes(1)
    await command.deliver()
    expect((await hints())[0]).toEqual({
      connectionId: CONNECTION,
      category: 'Day spa',
      readAt: NOW,
    })
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('keeps a cleared category empty when Google supplies none', async () => {
    await disconnect('local')
    await reconnect(async () => providerCategory(null)).runAndRefresh()
    expect((await hints())[0]).toEqual({
      connectionId: CONNECTION,
      category: null,
      readAt: null,
    })
  })

  it.each(['account_disconnect', 'binding_change'] as const)(
    'rejects a late category response after %s',
    async (change) => {
      await disconnect('local')
      const connecting = reconnect(async () => {
        if (change === 'account_disconnect') await disconnect('local')
        else
          await db
            .update(properties)
            .set({ sourceEpoch: sql`${properties.sourceEpoch} + 1` })
            .where(eq(properties.googleConnectionId, CONNECTION))
        return providerCategory('Restaurant')
      }).runAndRefresh()
      if (change === 'account_disconnect') {
        await expect(connecting).rejects.toMatchObject({ code: 'oauth_failed' })
      } else await connecting
      expect((await hints())[0]).toEqual({
        connectionId: CONNECTION,
        category: null,
        readAt: null,
      })
    },
  )

  it('refuses stale disconnected cleanup after account reconnect without redaction, fact or purge', async () => {
    const old = await store.disconnectGoogleAccount({
      organizationId: ORG,
      connectionId: CONNECTION,
      event: event(),
    })
    const forConnection = vi.fn()
    const repo = createGoogleConnectionRepository(db, () => NOW)
    const command = disconnectGoogleAccount({
      connectionRepo: {
        ...repo,
        findById: async () => {
          await reconnect(async () => providerCategory('Day spa')).runAndRefresh()
          return old
        },
      },
      commandStore: store,
      oauth: createInMemoryGoogleOAuthPort(),
      encryption: createInMemoryTokenEncryption(),
      clock: () => NOW,
      logger: createMockLogger(),
      sourceContentPurge: {
        forConnection,
        forProperty: vi.fn(),
        forOrganization: vi.fn(),
        inboxForProperty: vi.fn(),
      },
    })
    await expect(
      command(
        { connectionId: CONNECTION },
        buildTestAuthContext({
          organizationId: ORG,
          userId: ACTOR,
          role: 'AccountAdmin',
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_transition' })
    expect(await repo.findById(ORG, CONNECTION)).toMatchObject({
      status: 'active',
      googleSubject: 'google-subject-123',
    })
    expect((await hints())[0]?.category).toBe('Day spa')
    expect(forConnection).not.toHaveBeenCalled()
    expect(
      await db
        .select()
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.organizationId, ORG),
            eq(outboxEvents.eventType, 'integration.google_account.disconnected'),
          ),
        ),
    ).toHaveLength(1)
  })

  it('fences category publication when disconnect commits after publication authorization', async () => {
    await disconnect('local')
    await reconnect(
      async () => providerCategory('Restaurant'),
      () => disconnect('local'),
    ).runAndRefresh()
    expect((await hints())[0]).toEqual({
      connectionId: CONNECTION,
      category: null,
      readAt: null,
    })
  })

  it('refuses cleanup from an earlier disconnected generation after reconnect and another disconnect', async () => {
    const old = await store.disconnectGoogleAccount({
      organizationId: ORG,
      connectionId: CONNECTION,
      event: event(),
    })
    await reconnect(async () => providerCategory('Day spa')).runAndRefresh()
    await disconnect('local')
    await db
      .update(properties)
      .set({ googlePrimaryCategory: 'Restaurant', googlePrimaryCategoryUpdatedAt: NOW })
      .where(eq(properties.googleConnectionId, CONNECTION))
    await expect(
      store.disconnectGoogleAccount({
        organizationId: ORG,
        connectionId: CONNECTION,
        cleanupOnly: { lifecycleVersion: old.lifecycleVersion },
        event: event(),
      }),
    ).rejects.toMatchObject({ code: 'invalid_transition' })
    expect((await hints())[0]).toEqual({
      connectionId: CONNECTION,
      category: 'Restaurant',
      readAt: NOW,
    })
  })

  it.each(['local', 'governed'] as const)(
    '%s disconnect clears only categories for its tenant and connection',
    async (operation) => {
      await disconnect(operation)
      expect(await hints()).toEqual([
        { connectionId: CONNECTION, category: null, readAt: null },
        { connectionId: SIBLING_CONNECTION, category: 'Day spa', readAt: NOW },
        { connectionId: OTHER_CONNECTION, category: 'Restaurant', readAt: NOW },
      ])
      const [connection] = await db
        .select({ status: googleConnections.status })
        .from(googleConnections)
        .where(eq(googleConnections.id, CONNECTION))
      expect(connection?.status).toBe('disconnected')
    },
  )

  it.each(['local', 'governed'] as const)(
    '%s disconnect rolls category cleanup back with a refused outbox fact',
    async (operation) => {
      const before = await hints()
      const invalid = {
        ...event(),
        _tag: 'integration.unregistered',
      } as unknown as ReturnType<typeof event>
      await expect(disconnect(operation, invalid)).rejects.toThrow(
        /is not registered for the outbox/,
      )
      expect(await hints()).toEqual(before)
      const [connection] = await db
        .select({ status: googleConnections.status })
        .from(googleConnections)
        .where(eq(googleConnections.id, CONNECTION))
      expect(connection?.status).toBe('active')
    },
  )

  it('clears the category when elapsed governed cleanup finishes locally', async () => {
    await seedAttempt()
    expect(await revoke.reconcileElapsed({ now: NOW, limit: 10 })).toMatchObject({
      confirmedNotSent: 1,
    })
    expect((await hints())[0]).toEqual({
      connectionId: CONNECTION,
      category: null,
      readAt: null,
    })
  })

  it('preserves every hint when the account only needs reauthorization', async () => {
    const before = await hints()
    await store.requireReauthorization({
      organizationId: ORG,
      connectionId: CONNECTION,
      expected: { lifecycleVersion: 1, credentialGeneration: 1 },
      event: integrationGoogleAccountReauthorizationRequired({
        organizationId: ORG,
        connectionId: CONNECTION,
        cause: 'provider_revoked',
        occurredAt: NOW,
      }),
    })
    expect(await hints()).toEqual(before)
  })

  it('clears a retained hint on an already-disconnected account without another fact', async () => {
    await disconnect('local')
    await db
      .update(properties)
      .set({ googlePrimaryCategory: 'Hotel', googlePrimaryCategoryUpdatedAt: NOW })
      .where(eq(properties.googleConnectionId, CONNECTION))
    const before = await db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(eq(outboxEvents.organizationId, ORG))
    await disconnect('local')
    expect((await hints())[0]).toEqual({
      connectionId: CONNECTION,
      category: null,
      readAt: null,
    })
    const after = await db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(eq(outboxEvents.organizationId, ORG))
    expect(after).toEqual(before)
  })

  it('allows a Property writer to finish its connection foreign-key check during disconnect', async () => {
    let disconnecting: ReturnType<typeof store.disconnectGoogleAccount> | undefined
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '1s'`)
        const writer = await tx.execute(sql`SELECT pg_backend_pid() AS pid`)
        const writerPid = Number(writer.rows[0]?.pid)
        await tx.execute(
          sql`SELECT id FROM properties WHERE google_connection_id = ${CONNECTION}::uuid FOR UPDATE`,
        )
        disconnecting = store.disconnectGoogleAccount({
          organizationId: ORG,
          connectionId: CONNECTION,
          event: event(),
        })
        // Wait until disconnect has its connection lock and waits for this Property.
        await vi.waitFor(
          async () => {
            const waiting = await db.execute(sql`
            SELECT EXISTS (SELECT 1 FROM pg_stat_activity
              WHERE ${writerPid} = ANY(pg_blocking_pids(pid))) AS blocked
          `)
            expect(waiting.rows[0]?.blocked).toBe(true)
          },
          { timeout: 3_000, interval: 20 },
        )
        // The lock PostgreSQL takes while validating a Property's connection FK.
        await tx.execute(
          sql`SELECT id FROM google_connections WHERE id = ${CONNECTION}::uuid FOR KEY SHARE`,
        )
      })
    } finally {
      await disconnecting
    }
    expect((await hints())[0]).toEqual({
      connectionId: CONNECTION,
      category: null,
      readAt: null,
    })
  })
})
