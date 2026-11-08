import { replyScopeEffects } from '#/contexts/reputation/application/public-api'
import { fixHistoryCutoff } from '#/contexts/review/infrastructure/repositories/review-provider-snapshot.repository'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { createPropertyGoogleBindingStore } from '#/contexts/property/infrastructure/property-google-binding-store'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { Pool } from 'pg'
import { createDatabase, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { googleConnections } from '#/shared/db/schema/google-connection.schema'
import { googleImportItems, googleImports } from '#/shared/db/schema/google-import.schema'
import { idempotencyReceipts, outboxEvents } from '#/shared/db/schema/outbox.schema'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import type { GoogleImportV2ItemJobData } from '../application/ports/gbp-queue.port'
import type { GoogleImportV2Intent } from '../application/ports/google-import-v2-store.port'
import { createGoogleImportV2ClaimReaper } from '../application/google-import-v2-claim-reaper'
import { createImportStore } from './import-store.server'

const NOW = new Date('2026-10-20T10:00:00.000Z')
const ORG_A = 'google-import-recovery-a'
const ORG_B = 'google-import-recovery-b'
const USER_ID = 'google-import-recovery-user'
const CONNECTION_A = randomUUID()
const CONNECTION_B = randomUUID()
const ORGS = [ORG_A, ORG_B]
const minuteAfter = (at: Date) => new Date(at.getTime() + 60_000)

function intent(organizationId = ORG_A, count = 1, now = NOW): GoogleImportV2Intent {
  const requestId = randomUUID()
  const connectionId = organizationId === ORG_A ? CONNECTION_A : CONNECTION_B
  return {
    id: requestId,
    requestId,
    organizationId,
    initiatedBy: USER_ID,
    wireReplay: { keyVersion: 'v1', digest: 'A'.repeat(43) },
    semanticReplay: { keyVersion: 'v1', digest: 'B'.repeat(43) },
    items: Array.from({ length: count }, () => ({
      id: randomUUID(),
      connectionId,
      existingPropertyId: null,
      destinationPropertyId: randomUUID(),
      providerAccountSuffix: 'account',
      providerLocationSuffix: randomUUID(),
      expectedConnectionLifecycleVersion: 1,
      expectedConnectionAccessVersion: 1,
      expectedCredentialGeneration: 1,
      authorization: {
        organizationId,
        userId: USER_ID,
        connectionId,
        connectionLifecycleVersion: 1,
        connectionAccessVersion: 1,
        credentialGeneration: 1,
        authorizationVector: {
          executionPolicyVersion: 'beta-local-2',
          role: 'Admin',
          permissionDigest: 'a'.repeat(64),
          principalKind: 'user',
          permissionVersion: 1,
          connectionLifecycleVersion: 1,
          connectionAccessVersion: 1,
          credentialGeneration: 1,
        },
      },
      expectedSourceEpoch: null,
      expectedProfileVersion: null,
      action: 'create',
      updateExistingProfile: true,
      propertyName: 'Recovery cafe',
      propertyAddress: null,
      countryCode: 'US',
      timezone: 'UTC',
      effectDeadlineAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
    })),
    now,
    outboxEventId: randomUUID(),
  }
}

describe('Google import durable recovery (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database
  let store: ReturnType<typeof createImportStore>

  async function clearWork() {
    await db
      .delete(idempotencyReceipts)
      .where(
        sql`${idempotencyReceipts.payload}->>'organizationId' IN (${ORG_A}, ${ORG_B})`,
      )
    await db.delete(googleImports).where(inArray(googleImports.organizationId, ORGS))
    await db.delete(outboxEvents).where(inArray(outboxEvents.organizationId, ORGS))
  }

  async function commit(organizationId = ORG_A, count = 1, now = NOW) {
    const work = intent(organizationId, count, now)
    await expect(store.commitImport(work)).resolves.toBe('committed')
    return work
  }

  async function readItem(itemId: string) {
    const [item] = await db
      .select()
      .from(googleImportItems)
      .where(eq(googleImportItems.id, itemId))
    if (!item) throw new Error('missing recovery fixture')
    return item
  }

  function recovery(clock: () => Date, deliveries: GoogleImportV2ItemJobData[]) {
    return createGoogleImportV2ClaimReaper({
      store,
      clock,
      processItem: vi.fn(async () => undefined),
      queue: {
        addImportItemJobs: async (jobs) => {
          deliveries.push(...jobs)
        },
      },
      newDeliveryId: randomUUID,
      logger: { warn: vi.fn() },
    })
  }

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 6)
    db = createDatabase(lease.pool)
    store = createImportStore(db, () => NOW, {
      ensureImportFollowUps: createPropertyGoogleBindingStore(db, replyScopeEffects)
        .ensureImportFollowUps,
      readReceipt: createPropertyGoogleBindingStore(db, replyScopeEffects).readReceipt,
      prepareImportSync: (tx, scope) =>
        fixHistoryCutoff(tx, {
          ...scope,
          organizationId: organizationId(scope.organizationId),
          propertyId: propertyId(scope.propertyId),
        }),
    })
    registerAllEventSchemas()
    await clearWork()
    await db
      .delete(googleConnections)
      .where(inArray(googleConnections.organizationId, ORGS))
    await deleteTestOrganizations(db, ORGS)
    for (const organizationId of ORGS) {
      await db.execute(sql`
        INSERT INTO organization (id, name, slug, "createdAt")
        VALUES (${organizationId}, 'Google import recovery', ${organizationId}, ${NOW})
      `)
      await db.insert(googleConnections).values({
        id: organizationId === ORG_A ? CONNECTION_A : CONNECTION_B,
        organizationId,
        googleSubject: organizationId,
        encryptedAccessToken: 'test-access',
        encryptedRefreshToken: 'test-refresh',
        tokenExpiresAt: new Date(NOW.getTime() + 86_400_000),
        scopes: ['https://www.googleapis.com/auth/business.manage'],
        connectedBy: USER_ID,
        createdAt: NOW,
        updatedAt: NOW,
      })
    }
  })

  beforeEach(clearWork)

  afterAll(async () => {
    try {
      if (db) {
        await clearWork()
        await db
          .delete(googleConnections)
          .where(inArray(googleConnections.organizationId, ORGS))
        await deleteTestOrganizations(db, ORGS)
      }
    } finally {
      await lease?.release()
    }
  })

  it('retains the frozen principal for Retry and scrubs it when the item ends', async () => {
    const work = await commit()
    const item = work.items[0]!
    const terminal = {
      organizationId: ORG_A,
      itemId: item.id,
      retryRevision: 0,
      authority: { kind: 'lifecycle' },
      now: NOW,
    } as const
    await expect(
      store.terminalizeItem({
        ...terminal,
        outcomeCode: 'temporarily_unavailable',
        retainRetryState: true,
      }),
    ).resolves.toBe('completed')
    await expect(readItem(item.id)).resolves.toMatchObject({
      expectedPrincipalKind: 'user',
      expectedPermissionVersion: 1,
    })
    await expect(
      store.terminalizeItem({
        ...terminal,
        outcomeCode: 'authorization_changed',
        retainRetryState: false,
      }),
    ).resolves.toBe('completed')
    await expect(readItem(item.id)).resolves.toMatchObject({
      expectedPrincipalKind: null,
      expectedPermissionVersion: null,
    })
  })

  it('reserves at most 100 disjoint rows per call and skips a row held by another transaction', async () => {
    const first = await commit(ORG_A, 100)
    await commit(ORG_A, 100)
    await commit(ORG_B, 5)
    const heldItem = first.items[0]!
    const client = await lease.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT id FROM google_import_items WHERE id = $1 FOR UPDATE', [
        heldItem.id,
      ])
      const [left, right] = await Promise.all([
        store.reserveDueItems(NOW, 100),
        store.reserveDueItems(NOW, 100),
      ])
      expect(left).toHaveLength(100)
      expect(right).toHaveLength(100)
      const reservedIds = [...left, ...right].map((item) => item.itemId)
      expect(new Set(reservedIds).size).toBe(200)
      expect(reservedIds).not.toContain(heldItem.id)
      const remaining = await store.reserveDueItems(NOW, 100)
      expect(remaining).toHaveLength(4)
      expect(remaining.map((item) => item.itemId)).not.toContain(heldItem.id)
      await client.query('COMMIT')
      await expect(store.reserveDueItems(NOW, 100)).resolves.toMatchObject([
        { itemId: heldItem.id },
      ])
      await expect(store.reserveDueItems(NOW, 100)).resolves.toEqual([])
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })

  it('rejects a recovery batch outside the bounded 1 to 100 range', async () => {
    await expect(store.reserveDueItems(NOW, 0)).rejects.toThrow(
      'google import recovery limit must be between 1 and 100',
    )
    await expect(store.reserveDueItems(NOW, 101)).rejects.toThrow(
      'google import recovery limit must be between 1 and 100',
    )
  })

  it('recovers an empty queue and keeps an earlier delivery valid over several sweeps', async () => {
    const work = await commit()
    const item = work.items[0]!
    const deliveries: GoogleImportV2ItemJobData[] = []
    let now = NOW
    const sweep = recovery(() => now, deliveries)
    for (let index = 0; index < 4; index++) {
      await sweep()
      now = minuteAfter(now)
    }
    expect(deliveries).toHaveLength(4)
    const original = deliveries[0]!
    expect(deliveries.every((delivery) => delivery.itemId === item.id)).toBe(true)
    expect(new Set(deliveries.map((delivery) => delivery.jobId)).size).toBe(4)
    expect(new Set(deliveries.map((delivery) => delivery.dispatchEpoch)).size).toBe(1)
    await expect(
      store.claimItem({
        organizationId: ORG_A,
        itemId: item.id,
        retryRevision: original.retryRevision,
        dispatchEpoch: original.dispatchEpoch,
        attemptOrdinal: 1,
        claimFence: randomUUID(),
        now,
        leaseExpiresAt: minuteAfter(now),
      }),
    ).resolves.toMatchObject({ kind: 'claimed', item: { attemptOrdinal: 1 } })
    await sweep()
    expect(deliveries).toHaveLength(4)
    await expect(store.getProgress(ORG_A, USER_ID, work.id)).resolves.toMatchObject({
      processedCount: 0,
      counts: { pending: 0, processing: 1 },
    })
  })

  it('spends persistent attempts across worker deaths even when every delivery reports attempt one', async () => {
    const work = await commit()
    const item = work.items[0]!
    let now = NOW
    let firstEpoch: number | undefined
    let previousEpoch: number | undefined
    const firstFence = randomUUID()
    for (let ordinal = 1; ordinal <= 5; ordinal++) {
      const [due] = await store.reserveDueItems(now, 100)
      expect(due?.itemId).toBe(item.id)
      if (!due) throw new Error('recovery appointment was not retained')
      if (previousEpoch !== undefined)
        expect(due.dispatchEpoch).toBeGreaterThan(previousEpoch)
      firstEpoch ??= due.dispatchEpoch
      const claimFence = ordinal === 1 ? firstFence : randomUUID()
      await expect(
        store.claimItem({
          organizationId: ORG_A,
          itemId: item.id,
          retryRevision: 0,
          dispatchEpoch: due.dispatchEpoch,
          attemptOrdinal: 1,
          claimFence,
          now,
          leaseExpiresAt: minuteAfter(now),
        }),
      ).resolves.toMatchObject({ kind: 'claimed', item: { attemptOrdinal: ordinal } })
      now = minuteAfter(now)
      await expect(
        store.releaseClaimForRetry({
          organizationId: ORG_A,
          itemId: item.id,
          retryRevision: 0,
          dispatchEpoch: due.dispatchEpoch,
          claimFence,
          now,
        }),
      ).resolves.toBe('released')
      previousEpoch = due.dispatchEpoch
      now = minuteAfter(now)
    }
    const current = await readItem(item.id)
    expect(current.highestAttemptForRevision).toBe(5)
    const effect = vi.fn(async () => 'stale')
    await expect(
      store.runClaimedEffect(
        {
          organizationId: ORG_A,
          itemId: item.id,
          retryRevision: 0,
          dispatchEpoch: firstEpoch!,
          attemptOrdinal: 1,
          claimFence: firstFence,
          now,
        },
        effect,
      ),
    ).resolves.toEqual({ kind: 'lost' })
    expect(effect).not.toHaveBeenCalled()
    await expect(
      store.claimItem({
        organizationId: ORG_A,
        itemId: item.id,
        retryRevision: 0,
        dispatchEpoch: current.dispatchEpoch,
        attemptOrdinal: 1,
        claimFence: randomUUID(),
        now,
        leaseExpiresAt: minuteAfter(now),
      }),
    ).resolves.toMatchObject({ kind: 'ignored' })
    await expect(readItem(item.id)).resolves.toMatchObject({
      highestAttemptForRevision: 5,
    })
  })

  it('rotates a full page of failing exhausted claims so another tenant is dispatched on the next sweep', async () => {
    await commit(ORG_A, 100)
    await commit(ORG_A, 1)
    const healthy = await commit(ORG_B, 1, new Date(NOW.getTime() + 1))
    await db
      .update(googleImportItems)
      .set({
        status: 'processing',
        highestAttemptForRevision: 5,
        claimFence: randomUUID(),
        claimLeaseExpiresAt: NOW,
        nextDispatchAt: NOW,
      })
      .where(eq(googleImportItems.organizationId, ORG_A))
    const deliveries: GoogleImportV2ItemJobData[] = []
    const processItem = vi.fn(async () => {
      throw new Error('receipt unavailable')
    })
    const sweep = createGoogleImportV2ClaimReaper({
      store,
      clock: () => minuteAfter(NOW),
      processItem,
      queue: {
        addImportItemJobs: async (jobs) => {
          deliveries.push(...jobs)
        },
      },
      newDeliveryId: randomUUID,
      logger: { warn: vi.fn() },
    })

    await expect(sweep()).resolves.toMatchObject({
      dueItemsVisited: 100,
      itemFailures: 100,
    })
    expect(deliveries).toEqual([])
    await expect(sweep()).resolves.toMatchObject({
      dueItemsVisited: 2,
      itemFailures: 1,
      itemsDispatched: 1,
    })
    expect(processItem).toHaveBeenCalledTimes(101)
    expect(deliveries).toMatchObject([
      { organizationId: ORG_B, itemId: healthy.items[0]!.id },
    ])
    const poisonedRows = await db
      .select()
      .from(googleImportItems)
      .where(eq(googleImportItems.organizationId, ORG_A))
    expect(poisonedRows).toHaveLength(101)
    expect(poisonedRows.every((item) => item.nextDispatchAt! > minuteAfter(NOW))).toBe(
      true,
    )
    await expect(store.getProgress(ORG_B, USER_ID, healthy.id)).resolves.toMatchObject({
      processedCount: 0,
      counts: { pending: 1, processing: 0 },
    })
  })

  it.each(['terminalize', 'complete', 'receipt'] as const)(
    'keeps parent counts and terminal clocks valid across clock changes via %s',
    async (path) => {
      const pool = new Pool({
        connectionString: getEnv().DATABASE_URL,
        options: '-c timezone=Europe/Sofia',
        max: 1,
      })
      const zonedDb = createDatabase(pool)
      const zonedStore = createImportStore(zonedDb, () => NOW, {
        ensureImportFollowUps: createPropertyGoogleBindingStore(
          zonedDb,
          replyScopeEffects,
        ).ensureImportFollowUps,
        readReceipt: createPropertyGoogleBindingStore(zonedDb, replyScopeEffects)
          .readReceipt,
        prepareImportSync: (tx, scope) =>
          fixHistoryCutoff(tx, {
            ...scope,
            organizationId: organizationId(scope.organizationId),
            propertyId: propertyId(scope.propertyId),
          }),
      })
      try {
        for (const at of [NOW, new Date('2026-03-20T10:00:00.000Z')]) {
          const work = await commit(ORG_A, 2, at)
          for (const [index, item] of work.items.entries()) {
            const terminal = {
              organizationId: ORG_A,
              itemId: item.id,
              retryRevision: 0,
              outcomeCode: 'property_deleted',
              retainRetryState: false,
              now: at,
            } as const
            if (path === 'terminalize') {
              await expect(
                zonedStore.terminalizeItem({
                  ...terminal,
                  authority: { kind: 'pending', dispatchEpoch: 0 },
                }),
              ).resolves.toBe('completed')
            } else if (path === 'complete') {
              const claimFence = randomUUID()
              await expect(
                zonedStore.claimItem({
                  ...terminal,
                  dispatchEpoch: 0,
                  attemptOrdinal: 1,
                  claimFence,
                  leaseExpiresAt: minuteAfter(at),
                }),
              ).resolves.toMatchObject({ kind: 'claimed' })
              await expect(
                zonedStore.completeClaim({ ...terminal, dispatchEpoch: 0, claimFence }),
              ).resolves.toBe('completed')
            } else {
              await zonedDb.insert(idempotencyReceipts).values({
                scope: 'property_operation',
                key: JSON.stringify([ORG_A, item.id]),
                payload: {
                  organizationId: ORG_A,
                  idempotencyKey: item.id,
                  destinationPropertyId: null,
                  outcome: 'property_deleted',
                  destinationSourceEpoch: 0,
                  destinationProfileVersion: 1,
                  tombstone: true,
                  expiresAt: minuteAfter(at).toISOString(),
                  retentionReleasedAt: null,
                },
              })
              await expect(
                zonedStore.reconcileFromReceipt({
                  ...terminal,
                }),
              ).resolves.toBe('completed')
            }

            const [parent] = await zonedDb
              .select({
                firstTerminalAt: googleImports.firstTerminalAt,
                purgeAt: googleImports.purgeAt,
                expectedPurgeAt:
                  sql<Date | null>`${googleImports.firstTerminalAt} + interval '30 days'`.mapWith(
                    googleImports.purgeAt,
                  ),
              })
              .from(googleImports)
              .where(eq(googleImports.id, work.id))
            expect(parent).toMatchObject({
              firstTerminalAt: index === 0 ? null : at,
            })
            expect(parent?.purgeAt).toEqual(parent?.expectedPurgeAt)
          }
        }
      } finally {
        await pool.end()
      }
    },
  )

  it('cannot apply a scanned recovery authority after another worker takes over', async () => {
    const work = await commit()
    const item = work.items[0]!
    const [initial] = await store.reserveDueItems(NOW, 100)
    if (!initial) throw new Error('missing initial delivery')
    const oldFence = randomUUID()
    await expect(
      store.claimItem({
        organizationId: ORG_A,
        itemId: item.id,
        retryRevision: 0,
        dispatchEpoch: initial.dispatchEpoch,
        attemptOrdinal: 1,
        claimFence: oldFence,
        now: NOW,
        leaseExpiresAt: minuteAfter(NOW),
      }),
    ).resolves.toMatchObject({ kind: 'claimed' })
    const expiredAt = minuteAfter(NOW)
    const [scanned] = await store.reserveDueItems(expiredAt, 100)
    expect(scanned).toMatchObject({ itemId: item.id, claimFence: oldFence })
    if (!scanned) throw new Error('missing elapsed claim')
    const freshFence = randomUUID()
    const takeover = await store.claimItem({
      organizationId: ORG_A,
      itemId: item.id,
      retryRevision: 0,
      dispatchEpoch: scanned.dispatchEpoch,
      attemptOrdinal: 1,
      claimFence: freshFence,
      now: expiredAt,
      leaseExpiresAt: minuteAfter(expiredAt),
    })
    expect(takeover).toMatchObject({
      kind: 'claimed',
      item: { claimFence: freshFence, attemptOrdinal: 2 },
    })
    if (takeover.kind !== 'claimed') throw new Error('takeover was not admitted')
    expect(takeover.item.dispatchEpoch).toBeGreaterThan(scanned.dispatchEpoch)
    await expect(
      store.releaseClaimForRetry({
        organizationId: ORG_A,
        itemId: item.id,
        retryRevision: 0,
        dispatchEpoch: scanned.dispatchEpoch,
        claimFence: oldFence,
        now: expiredAt,
      }),
    ).resolves.toBe('lost')
    const terminal = {
      organizationId: ORG_A,
      itemId: item.id,
      retryRevision: 0,
      outcomeCode: 'internal_error',
      retainRetryState: false,
      now: expiredAt,
    } as const
    await expect(
      store.terminalizeItem({
        ...terminal,
        authority: {
          kind: 'expired_claim',
          dispatchEpoch: scanned.dispatchEpoch,
          claimFence: oldFence,
        },
      }),
    ).resolves.toBe('lost')
    await expect(
      store.terminalizeItem({
        ...terminal,
        authority: { kind: 'pending', dispatchEpoch: scanned.dispatchEpoch },
      }),
    ).resolves.toBe('lost')
    const staleEffect = vi.fn(async () => 'stale')
    await expect(
      store.runClaimedEffect(
        {
          organizationId: ORG_A,
          itemId: item.id,
          retryRevision: 0,
          dispatchEpoch: scanned.dispatchEpoch,
          attemptOrdinal: 1,
          claimFence: oldFence,
          now: expiredAt,
        },
        staleEffect,
      ),
    ).resolves.toEqual({ kind: 'lost' })
    expect(staleEffect).not.toHaveBeenCalled()
    await expect(store.getProgress(ORG_A, USER_ID, work.id)).resolves.toMatchObject({
      status: 'processing',
      processedCount: 0,
      counts: { pending: 0, processing: 1, failed: 0 },
    })
    const finish = () =>
      store.terminalizeItem({
        ...terminal,
        authority: {
          kind: 'claim',
          dispatchEpoch: takeover.item.dispatchEpoch,
          claimFence: freshFence,
        },
      })
    await expect(finish()).resolves.toBe('completed')
    await expect(finish()).resolves.toBe('lost')
    await expect(store.getProgress(ORG_A, USER_ID, work.id)).resolves.toMatchObject({
      status: 'failed',
      processedCount: 1,
      counts: { pending: 0, processing: 0, failed: 1 },
    })
  })
})
