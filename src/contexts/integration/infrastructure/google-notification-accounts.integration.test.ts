import { createGoogleBindingFollowUpHandlers } from './google-binding-follow-up-consumers'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import type { PropertyGoogleBindingPublicApi } from '#/contexts/property/application/public-api'
import { getEnv } from '#/shared/config/env'
import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createInMemoryMyBusinessNotificationsPort } from '#/shared/testing/in-memory-mybusiness-notifications-port'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import { manageNotifications } from '../application/use-cases/manage-notifications'
import { createGoogleNotificationAccounts } from './google-notification-accounts'
import { createGbpNotificationReconciliation } from '../application/use-cases/reconcile-gbp-notification-subscriptions'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('account subscription ordering through PostgreSQL', () => {
  let lease: TestLease
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
  })
  afterAll(async () => {
    await lease?.release()
  })

  it('does not let a concurrent import finish subscribing between the disconnect usage read and clear', async () => {
    const accountId = randomUUID()
    const connectionId = googleConnectionId(randomUUID())
    const org = organizationId(randomUUID())
    const now = new Date('2026-11-08T00:00:00Z')
    const usageRead = deferred()
    const finishUsageRead = deferred()
    const notifications = createInMemoryMyBusinessNotificationsPort()
    const make = (organization: typeof org) =>
      manageNotifications({
        accounts: createGoogleNotificationAccounts(drizzle(lease.pool), () => now),
        nowMs: () => now.getTime(),
        authorizeProviderCall: async () => ({
          ok: true,
          targets: [
            {
              accessToken: 'test-token',
              gbpAccountId: accountId,
              authorization: {
                capability: 'property.connect_gbp',
                organizationId: organization,
                propertyId: propertyId(randomUUID()),
                connectionId,
                initiatorUserId: null,
                expectedCredentialGeneration: 1,
                authorizationVector: { propertySourceEpoch: 1 },
              },
            },
          ],
        }),
        hasOtherActiveAccountBinding: async () => {
          usageRead.resolve()
          await finishUsageRead.promise
          return false
        },
        notifications,
        pubsubTopic: 'projects/test/topics/reviews',
        notificationTypes: ['NEW_REVIEW'],
        logger: createMockLogger(),
      })
    const disconnecting = make(org)
    const importingOrg = organizationId(randomUUID())
    const importing = make(importingOrg)
    const disconnect = disconnecting.unsubscribe(org, connectionId)
    await usageRead.promise
    let imported
    try {
      imported = await importing.subscribe(importingOrg, connectionId)
    } finally {
      finishUsageRead.resolve()
    }
    await disconnect
    expect(imported.outcome).toBe('provider_failed')
    expect(imported.accounts.failureCodes).toEqual({ coordination_unavailable: 1 })
    expect(notifications.subscribeCalls).toHaveLength(0)
    expect(notifications.unsubscribeCalls).toHaveLength(1)
    await expect(importing.subscribe(importingOrg, connectionId)).resolves.toMatchObject({
      outcome: 'subscribed',
    })
    expect(notifications.subscribeCalls).toHaveLength(1)
    await expect(importing.subscribe(importingOrg, connectionId)).resolves.toMatchObject({
      outcome: 'already_subscribed',
    })
  })
  it('checks only two accounts for 100 imported Properties across handler and process restarts', async () => {
    registerAllEventSchemas()
    const org = organizationId(randomUUID())
    const connectionId = googleConnectionId(randomUUID())
    const accountIds = [randomUUID(), randomUUID()]
    const now = new Date('2026-11-08T00:00:00Z')
    const notifications = createInMemoryMyBusinessNotificationsPort()
    const receipts = new Set<string>()
    let currentAccount = accountIds[0]!
    const makeHandlers = () => {
      const management = manageNotifications({
        accounts: createGoogleNotificationAccounts(drizzle(lease.pool), () => now),
        nowMs: () => now.getTime(),
        authorizeProviderCall: async () => ({
          ok: true,
          targets: accountIds.map((gbpAccountId) => ({
            accessToken: 'test-token',
            gbpAccountId,
            authorization: {
              capability: 'property.connect_gbp' as const,
              organizationId: org,
              propertyId: propertyId(randomUUID()),
              connectionId,
              initiatorUserId: null,
              expectedCredentialGeneration: 1,
              authorizationVector: { propertySourceEpoch: 1 },
            },
          })),
        }),
        hasOtherActiveAccountBinding: async () => false,
        notifications,
        pubsubTopic: 'projects/test/topics/reviews',
        notificationTypes: ['NEW_REVIEW'],
        logger: createMockLogger(),
      })
      return {
        management,
        handlers: createGoogleBindingFollowUpHandlers({
          propertyBindingApi: {
            readInternal: async () => ({
              accountId: currentAccount,
              connectionId,
              locationId: 'location',
              state: 'active',
              lifecycleState: 'active',
              deletedAt: null,
              sourceEpoch: 1,
            }),
          } as unknown as PropertyGoogleBindingPublicApi,
          subscribe: management.subscribe,
          receipts: {
            hasReceipt: async (id, consumer) => receipts.has(`${id}:${consumer}`),
            insertReceipt: async (id, consumer) => {
              receipts.add(`${id}:${consumer}`)
            },
          },
          newDeliveryId: randomUUID,
        }),
      }
    }
    let runtime = makeHandlers()
    for (let index = 0; index < 100; index += 1) {
      if (index % 10 === 0) runtime = makeHandlers()
      currentAccount = accountIds[index < 60 ? 0 : 1]!
      const id = randomUUID()
      await runtime.handlers.subscription({
        eventId: randomUUID(),
        eventType: 'property.google_binding.changed',
        eventVersion: 1,
        organizationId: org,
        propertyId: id,
        sourceContext: 'property',
        sourceAggregateId: id,
        payload: {
          organizationId: org,
          propertyId: id,
          connectionId,
          sourceEpoch: 1,
          change: 'created',
          importFollowUps: true,
          occurredAt: now.toISOString(),
        },
      })
    }
    expect(receipts.size).toBe(100)
    expect(notifications.subscribeCalls.map((call) => call.gbpAccountId)).toEqual(
      accountIds,
    )
    // A forced reconciliation still reads both settings, even within the reuse window.
    await runtime.management.subscribe(org, connectionId)
    expect(notifications.subscribeCalls).toHaveLength(4)
    await runtime.management.unsubscribe(org, connectionId)
    await runtime.management.subscribe(org, connectionId, {
      gbpAccountId: accountIds[0]!,
      reuseVerified: true,
    })
    expect(notifications.subscribeCalls).toHaveLength(5)
    expect(notifications.subscribeCalls[4]?.gbpAccountId).toBe(accountIds[0])
  })

  it('persists oldest-account progress across bounded reconciliation restarts, including failures', async () => {
    let now = new Date('2026-11-08T00:00:00Z')
    const db = drizzle(lease.pool)
    const orgA = organizationId('a-first-organization')
    const orgB = organizationId('z-last-organization')
    const candidates = [
      { organizationId: orgA, connectionId: randomUUID(), gbpAccountId: randomUUID() },
      { organizationId: orgB, connectionId: randomUUID(), gbpAccountId: randomUUID() },
      { organizationId: orgB, connectionId: randomUUID(), gbpAccountId: randomUUID() },
    ]
    // Input and Organization order both oppose the persisted attempt order.
    for (const candidate of [...candidates].reverse()) {
      await createGoogleNotificationAccounts(db, () => now).attempted(
        candidate.gbpAccountId,
      )
      now = new Date(now.getTime() + 100)
    }
    const visited: string[] = []
    for (let run = 0; run < 3; run += 1) {
      const accounts = createGoogleNotificationAccounts(db, () => now)
      const reconcile = createGbpNotificationReconciliation({
        topicConfigured: true,
        listAccounts: async () =>
          Promise.all(
            candidates.map(async (candidate) => ({
              ...candidate,
              attemptedAt:
                (await accounts.read(candidate.gbpAccountId))?.attemptedAt ?? null,
            })),
          ),
        recordAttempt: accounts.attempted,
        backfill: {
          apply: async (organization, scope) => {
            visited.push(scope!.gbpAccountId)
            now = new Date(now.getTime() + 100)
            if (run === 0) throw new Error('Provider unavailable')
            return {
              action: 'subscribe',
              organizationId: organization,
              connections: 1,
              candidates: 1,
              counts: { already_subscribed: 1 },
              accounts: {
                subscribed: 0,
                alreadySubscribed: 1,
                failed: 0,
                failureCodes: {},
              },
              connectionOutcomes: [],
            }
          },
        },
        nowMs: () => now.getTime(),
      })
      const summary = await reconcile({
        authorizeOrganization: async () => true,
        deadlineAtMs: now.getTime() + 50,
      })
      expect(summary).toMatchObject({
        organizationsFailed: run === 0 ? 1 : 0,
        retry: run === 0,
      })
    }
    expect(visited).toEqual(
      [...candidates].reverse().map((candidate) => candidate.gbpAccountId),
    )
  })
})
