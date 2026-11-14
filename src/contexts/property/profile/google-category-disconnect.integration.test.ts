import { replyScopeEffects } from '#/contexts/reputation/application/public-api'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { seedGoogleConnection } from '#/shared/testing/google-connection-seed'
import { drizzleSeedRunner } from '#/shared/db/testing/drizzle-seed-runner'
import { getDb, type Database } from '#/shared/db'
import {
  googleConnections,
  idempotencyReceipts,
  outboxEvents,
  properties,
} from '#/shared/db/schema'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import type { Tx } from '#/shared/outbox/commit'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { createInMemoryGoogleOAuthPort } from '#/shared/testing/in-memory-google-oauth-port'
import { createTestTokenEncryption } from '#/contexts/integration/connections/token-encryption.test-fixtures'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { disconnectGoogleAccount } from '#/contexts/integration/application/use-cases/disconnect-google-account'
import { integrationGoogleAccountDisconnected } from '#/contexts/integration/domain/events'
import { createAtomicIntegrationCommandStore } from '#/contexts/integration/infrastructure/integration-command-store'
import { createGoogleConnectionRepository } from '#/contexts/integration/infrastructure/repositories/google-connection.repository'
import { buildGoogleImportedProperty } from '../application/build-google-imported-property'
import { disconnectPropertyGoogleBinding } from '../application/use-cases/property-lifecycle'
import { createPropertyGoogleBindingStore } from './google-binding-store.server'
import { createPropertyRepository } from '../infrastructure/repositories/property.repository'

const db = getDb()
const ORG = organizationId('org-category-publication-disconnect')
const CONNECTION = googleConnectionId('7b000000-0000-4000-8000-000000000001')
const PROPERTY = propertyId('7b100000-0000-4000-8000-000000000001')
const RECEIPT = '7b200000-0000-4000-8000-000000000001'
const ACTOR = userId('category-publication-admin')
const NOW = new Date('2026-11-06T10:00:00Z')
const binding = createPropertyGoogleBindingStore(db, replyScopeEffects)
const admin = buildTestAuthContext({
  organizationId: ORG,
  userId: ACTOR,
  role: 'AccountAdmin',
})
const event = () =>
  integrationGoogleAccountDisconnected({
    organizationId: ORG,
    connectionId: CONNECTION,
    userId: ACTOR,
    occurredAt: NOW,
  })
const imported = () =>
  buildGoogleImportedProperty({
    organizationId: ORG,
    propertyId: PROPERTY,
    importItemId: RECEIPT,
    connectionId: CONNECTION,
    accountId: 'account',
    locationId: 'location',
    googlePrimaryCategory: 'Hotel',
    name: 'Synthetic Property',
    address: null,
    countryCode: 'BG',
    timezone: 'Europe/Sofia',
    confirmedBy: ACTOR,
    now: NOW,
  })

async function cleanup() {
  await db.delete(properties).where(eq(properties.organizationId, ORG))
  await db.delete(googleConnections).where(eq(googleConnections.organizationId, ORG))
  await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORG))
  await db
    .delete(idempotencyReceipts)
    .where(
      and(
        eq(idempotencyReceipts.scope, 'property_operation'),
        sql`${idempotencyReceipts.payload}->>'organizationId' = ${ORG}`,
      ),
    )
}

async function storedProperty() {
  const [row] = await db.select().from(properties).where(eq(properties.id, PROPERTY))
  return row
}

async function disconnect(database = db) {
  return createAtomicIntegrationCommandStore(database, () => NOW).disconnectGoogleAccount(
    {
      organizationId: ORG,
      connectionId: CONNECTION,
      event: event(),
    },
  )
}

async function preparePublication(action: 'create' | 'relink') {
  if (action === 'relink') {
    await db.insert(properties).values({
      id: PROPERTY,
      organizationId: ORG,
      name: 'Synthetic Property',
      slug: 'category-publication-target',
      timezone: 'Europe/Sofia',
    })
  }
}

function publish(action: 'create' | 'relink', database = db) {
  const store = createPropertyGoogleBindingStore(database, replyScopeEffects)
  if (action === 'create')
    return store.createBoundProperty({
      organizationId: ORG,
      idempotencyKey: RECEIPT,
      property: imported(),
      now: NOW,
    })
  return store.relink({
    organizationId: ORG,
    propertyId: PROPERTY,
    idempotencyKey: RECEIPT,
    connectionId: CONNECTION,
    accountId: 'account',
    locationId: 'location',
    expectedSourceEpoch: 0,
    expectedProfileVersion: 1,
    now: NOW,
    profile: {
      name: 'Synthetic Property',
      address: null,
      timezone: 'Europe/Sofia',
      confirmedBy: ACTOR,
      googlePrimaryCategory: 'Hotel',
    },
  })
}

// Hold the real transaction after its writes, with every row lock still held.
function holdCommit() {
  const reached = Promise.withResolvers<number>()
  const released = Promise.withResolvers<void>()
  const database = new Proxy(db, {
    get(target, key) {
      if (key !== 'transaction') return Reflect.get(target, key)
      return (work: (tx: Tx) => Promise<unknown>) =>
        db.transaction(async (tx) => {
          try {
            const result = await work(tx)
            const pid = await tx.execute(sql`SELECT pg_backend_pid() AS pid`)
            reached.resolve(Number(pid.rows[0]?.pid))
            await released.promise
            return result
          } catch (error) {
            reached.reject(error)
            throw error
          }
        })
    },
  }) satisfies Database
  return { database, reached: reached.promise, release: () => released.resolve() }
}

async function waitForOverlap(pid: number, finished: () => boolean) {
  await vi.waitFor(
    async () => {
      const waiting = await db.execute(sql`SELECT EXISTS (
      SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))
    ) AS blocked`)
      expect(finished() || waiting.rows[0]?.blocked === true).toBe(true)
    },
    { timeout: 3_000, interval: 20 },
  )
}

beforeAll(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})
beforeEach(async () => {
  await cleanup()
  await seedGoogleConnection(drizzleSeedRunner(db), {
    id: CONNECTION,
    organizationId: ORG,
    googleSubject: 'category-publication-subject',
    accessToken: 'synthetic',
    refreshToken: 'synthetic',
    tokenExpiresAt: new Date(NOW.getTime() + 60_000),
    connectedBy: ACTOR,
    scopes: ['https://www.googleapis.com/auth/business.manage'],
  })
})
afterAll(async () => {
  await cleanup()
  clearEventSchemas()
})

describe('Google category publication and public disconnect commands (PostgreSQL)', () => {
  it('Property retry clears a retained category without another generation or fact', async () => {
    await publish('create')
    await db
      .update(properties)
      .set({ lifecycleState: 'archived' })
      .where(eq(properties.id, PROPERTY))
    const command = disconnectPropertyGoogleBinding({
      propertyRepo: createPropertyRepository(db),
      bindingStore: binding,
      staffPublicApi: { getAccessiblePropertyIds: async () => null },
      clock: () => NOW,
    })
    const first = await command({ propertyId: PROPERTY }, admin)
    const before = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.organizationId, ORG))
    await db
      .update(properties)
      .set({ googlePrimaryCategory: 'Hotel', googlePrimaryCategoryUpdatedAt: NOW })
      .where(eq(properties.id, PROPERTY))
    expect(await command({ propertyId: PROPERTY }, admin)).toEqual(first)
    expect(await storedProperty()).toMatchObject({
      googlePrimaryCategory: null,
      googlePrimaryCategoryUpdatedAt: null,
    })
    expect(
      await db.select().from(outboxEvents).where(eq(outboxEvents.organizationId, ORG)),
    ).toEqual(before)
  })

  it('account retry clears retained categories without provider calls, new versions or another fact', async () => {
    await publish('create')
    const unsubscribe = vi.fn()
    const command = disconnectGoogleAccount({
      connectionRepo: createGoogleConnectionRepository(db, () => NOW),
      commandStore: createAtomicIntegrationCommandStore(db, () => NOW),
      oauth: createInMemoryGoogleOAuthPort(),
      encryption: createTestTokenEncryption(),
      logger: createMockLogger(),
      clock: () => NOW,
      unsubscribeFromNotifications: unsubscribe,
    })
    const first = await command({ connectionId: CONNECTION }, admin)
    const before = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.organizationId, ORG))
    await db
      .update(properties)
      .set({ googlePrimaryCategory: 'Hotel', googlePrimaryCategoryUpdatedAt: NOW })
      .where(eq(properties.id, PROPERTY))
    expect(await command({ connectionId: CONNECTION }, admin)).toEqual(first)
    expect(await storedProperty()).toMatchObject({
      googlePrimaryCategory: null,
      googlePrimaryCategoryUpdatedAt: null,
    })
    expect(
      await db.select().from(outboxEvents).where(eq(outboxEvents.organizationId, ORG)),
    ).toEqual(before)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it.each(['create', 'relink'] as const)(
    'refuses %s publication when disconnect holds authority first',
    async (action) => {
      await preparePublication(action)
      const held = holdCommit()
      const disconnecting = disconnect(held.database)
      let publishing: Promise<unknown> | undefined
      try {
        const pid = await held.reached
        let finished = false
        publishing = publish(action).then(
          (value) => {
            finished = true
            return { value }
          },
          (error) => {
            finished = true
            return { error }
          },
        )
        await waitForOverlap(pid, () => finished)
      } finally {
        held.release()
        await disconnecting
      }
      expect(await publishing).toMatchObject({
        error: { code: 'connection_unavailable' },
      })
      expect((await storedProperty())?.googlePrimaryCategory ?? null).toBeNull()
      expect(await binding.readReceipt(ORG, RECEIPT, NOW)).toBeNull()
    },
  )

  it.each(['create', 'relink'] as const)(
    'cleans %s publication when the writer holds authority first',
    async (action) => {
      await preparePublication(action)
      const held = holdCommit()
      const publishing = publish(action, held.database)
      let disconnecting: Promise<unknown> | undefined
      try {
        const pid = await held.reached
        let finished = false
        disconnecting = disconnect().finally(() => {
          finished = true
        })
        await waitForOverlap(pid, () => finished)
      } finally {
        held.release()
        await publishing
      }
      await disconnecting
      await expect(publish(action)).resolves.toMatchObject({ replayed: true })
      expect(await storedProperty()).toMatchObject({
        googlePrimaryCategory: null,
        googlePrimaryCategoryUpdatedAt: null,
      })
    },
  )
})
