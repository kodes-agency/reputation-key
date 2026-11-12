import { replyScopeEffects } from '#/contexts/reputation/application/public-api'
import { fixHistoryCutoff } from '#/contexts/review/infrastructure/repositories/review-provider-snapshot.repository'
import { buildGoogleImportedProperty } from '#/contexts/property/application/public-api'
import { organizationId, propertyId, googleConnectionId } from '#/shared/domain/ids'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { createDatabase, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { googleImportItems, googleImports } from '#/shared/db/schema/google-import.schema'
import { workItems } from '#/shared/db/schema/work-items.schema'
import { googleConnections } from '#/shared/db/schema/google-connection.schema'
import { idempotencyReceipts, outboxEvents } from '#/shared/db/schema/outbox.schema'
import { properties } from '#/shared/db/schema/property.schema'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { createPropertyGoogleBindingStore } from '#/contexts/property/infrastructure/property-google-binding-store'
import type { GoogleImportIntent } from '#/contexts/integration/application/ports/google-import-store.port'
import { createGoogleImportProcessor } from '#/contexts/integration/application/google-import-processor'
import { createGoogleImportClaimReaper } from '#/contexts/integration/application/google-import-claim-reaper'
import { createGoogleImportLifecycle } from '#/contexts/integration/application/google-import-lifecycle'
import { createImportStore } from '#/contexts/integration/imports/import-store.server'

const NOW = new Date('2026-08-12T10:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1_000
const ORG_ID = 'google-import-items-org'
const USER_ID = 'google-import-items-user'
const REQUEST_ID = '20000000-0000-4000-8000-000000000001'
const ITEM_ID = '20000000-0000-4000-8000-000000000002'
const CONNECTION_ID = '20000000-0000-4000-8000-000000000003'
const PROPERTY_ID = '20000000-0000-4000-8000-000000000004'
const OUTBOX_ID = '20000000-0000-4000-8000-000000000005'
const RETRY_REQUEST_ID = '20000000-0000-4000-8000-000000000010'
const RETRY_OUTBOX_ID = '20000000-0000-4000-8000-000000000011'
const OTHER_PROPERTY_ID = '20000000-0000-4000-8000-0000000000ff'

registerAllEventSchemas()

const matchesDigest =
  (expected: Readonly<{ keyVersion: string; digest: string }>) =>
  (stored: Readonly<{ keyVersion: string; digest: string }>) =>
    stored.keyVersion === expected.keyVersion && stored.digest === expected.digest

function intent(now = NOW, googlePrimaryCategory?: string | null): GoogleImportIntent {
  return {
    id: REQUEST_ID,
    organizationId: ORG_ID,
    requestId: REQUEST_ID,
    initiatedBy: USER_ID,
    wireReplay: { keyVersion: 'v1', digest: 'A'.repeat(43) },
    semanticReplay: { keyVersion: 'v1', digest: 'B'.repeat(43) },
    items: [
      {
        id: ITEM_ID,
        connectionId: CONNECTION_ID,
        existingPropertyId: null,
        destinationPropertyId: PROPERTY_ID,
        providerAccountSuffix: 'account-1',
        providerLocationSuffix: 'location-1',
        ...(googlePrimaryCategory === undefined ? {} : { googlePrimaryCategory }),
        expectedConnectionLifecycleVersion: 1,
        expectedConnectionAccessVersion: 1,
        expectedCredentialGeneration: 1,
        authorization: {
          organizationId: ORG_ID,
          userId: USER_ID,
          connectionId: CONNECTION_ID,
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
        propertyName: 'Cafe One',
        propertyAddress: '1 Main Street',
        countryCode: 'US',
        timezone: 'America/New_York',
        effectDeadlineAt: new Date(now.getTime() + DAY_MS),
      },
    ],
    now,
    outboxEventId: OUTBOX_ID,
  }
}

describe('Google import item behaviour on the import store (real PostgreSQL)', () => {
  let lease: TestLease | undefined
  let db: Database
  let store: ReturnType<typeof createImportStore>
  let binding: ReturnType<typeof createPropertyGoogleBindingStore>

  const clearRetryReceipts = async () => {
    await db
      .delete(idempotencyReceipts)
      .where(
        and(
          sql`${idempotencyReceipts.scope} IN ('gbp_import_item_retry', 'property_operation')`,
          sql`${idempotencyReceipts.payload}->>'organizationId' = ${ORG_ID}`,
        ),
      )
  }
  const resetStorage = async () => {
    await clearRetryReceipts()
    await db.delete(workItems).where(eq(workItems.organizationId, ORG_ID))
    await db.delete(googleImports).where(eq(googleImports.organizationId, ORG_ID))
    await db.delete(properties).where(eq(properties.organizationId, ORG_ID))
    await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORG_ID))
  }
  const clear = async () => {
    await resetStorage()
    await db.delete(googleConnections).where(eq(googleConnections.organizationId, ORG_ID))
    await deleteTestOrganizations(db, [ORG_ID])
  }
  const resetIntent = async () => {
    await resetStorage()
    await expect(store.commitImport(intent())).resolves.toBe('committed')
  }
  const readItem = async () => {
    const [row] = await db
      .select()
      .from(googleImportItems)
      .where(eq(googleImportItems.id, ITEM_ID))
    return row
  }
  const reapAt = (now: Date) => {
    const logger = createMockLogger()
    const processor = createGoogleImportProcessor({
      store,
      propertyBindingApi: binding,
      authorizeGoogleImportCommand: async () => ({
        ok: false,
        code: 'authorization_changed',
      }),
      resolveActor: async () => null,
      clock: () => now,
      newClaimFence: randomUUID,
      logger,
    })
    return createGoogleImportClaimReaper({
      store,
      processItem: processor.process,
      queue: { addImportItemJobs: vi.fn(async () => undefined) },
      clock: () => now,
      newDeliveryId: randomUUID,
      logger,
    })()
  }
  const recordReceipt = async (destination = PROPERTY_ID) => {
    await binding.createBoundProperty({
      organizationId: organizationId(ORG_ID),
      idempotencyKey: ITEM_ID,
      now: NOW,
      property: buildGoogleImportedProperty({
        organizationId: organizationId(ORG_ID),
        propertyId: propertyId(destination),
        importItemId: ITEM_ID,
        connectionId: googleConnectionId(CONNECTION_ID),
        accountId: 'account-1',
        locationId: 'location-1',
        name: 'Confirmed property',
        address: null,
        countryCode: 'US',
        timezone: 'UTC',
        confirmedBy: USER_ID,
        now: NOW,
      }),
    })
  }
  const claim = (claimFence: string, at = NOW) =>
    store.claimItem({
      dispatchEpoch: 0,
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      retryRevision: 0,
      attemptOrdinal: 1,
      claimFence,
      now: at,
      leaseExpiresAt: new Date(at.getTime() + 30_000),
    })
  const claimForTerminal = async (claimFence: string) => {
    await expect(claim(claimFence)).resolves.toMatchObject({ kind: 'claimed' })
    return {
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      retryRevision: 0,
      claimFence,
      retainRetryState: false,
      now: NOW,
    } as const
  }
  const lifecycleTerminal = (
    outcomeCode: 'temporarily_unavailable' | 'authorization_changed' | 'user_cancelled',
    now = NOW,
  ) =>
    store.terminalizeItem({
      authority: { kind: 'lifecycle' },
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      retryRevision: 0,
      outcomeCode,
      retainRetryState: outcomeCode === 'temporarily_unavailable',
      now,
    })

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 6)
    db = createDatabase(lease.pool)
    binding = createPropertyGoogleBindingStore(db, replyScopeEffects)
    store = createImportStore(db, () => NOW, {
      ensureImportFollowUps: binding.ensureImportFollowUps,
      readReceipt: binding.readReceipt,
      prepareImportSync: (tx, scope) =>
        fixHistoryCutoff(tx, {
          ...scope,
          organizationId: organizationId(scope.organizationId),
          propertyId: propertyId(scope.propertyId),
        }),
    })
    await clear()
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORG_ID}, 'Google import items test', ${ORG_ID}, ${NOW})
    `)
    await db.insert(googleConnections).values({
      id: CONNECTION_ID,
      organizationId: ORG_ID,
      googleSubject: 'google-import-items-subject',
      encryptedAccessToken: 'encrypted-access',
      encryptedRefreshToken: 'encrypted-refresh',
      tokenExpiresAt: new Date(NOW.getTime() + DAY_MS),
      scopes: ['https://www.googleapis.com/auth/business.manage'],
      connectedBy: USER_ID,
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  afterAll(async () => {
    try {
      if (db) await clear()
    } finally {
      await lease?.release()
    }
  })

  describe('claim fences', () => {
    it('rejects duplicate claims and never invokes a stale fenced effect', async () => {
      await resetIntent()
      const firstFence = '20000000-0000-4000-8000-000000000006'
      const competingFence = '20000000-0000-4000-8000-000000000007'

      await expect(claim(firstFence)).resolves.toMatchObject({
        kind: 'claimed',
        item: { authorization: intent().items[0]!.authorization },
      })
      await expect(claim(competingFence)).resolves.toEqual({
        kind: 'ignored',
        reason: 'claim_active',
      })

      const effect = vi.fn(async () => 'must-not-run')
      await expect(
        store.runClaimedEffect(
          {
            dispatchEpoch: 0,
            organizationId: ORG_ID,
            itemId: ITEM_ID,
            retryRevision: 0,
            attemptOrdinal: 1,
            claimFence: competingFence,
            now: NOW,
          },
          effect,
        ),
      ).resolves.toEqual({ kind: 'lost' })
      expect(effect).not.toHaveBeenCalled()
    })

    it('permits same-ordinal takeover only after lease expiry', async () => {
      await resetIntent()
      const staleFence = '20000000-0000-4000-8000-000000000008'
      const freshFence = '20000000-0000-4000-8000-000000000009'
      const expiredAt = new Date(NOW.getTime() + 1_000)

      await store.claimItem({
        dispatchEpoch: 0,
        organizationId: ORG_ID,
        itemId: ITEM_ID,
        retryRevision: 0,
        attemptOrdinal: 1,
        claimFence: staleFence,
        now: NOW,
        leaseExpiresAt: expiredAt,
      })
      await expect(
        store.claimItem({
          dispatchEpoch: 0,
          organizationId: ORG_ID,
          itemId: ITEM_ID,
          retryRevision: 0,
          attemptOrdinal: 1,
          claimFence: freshFence,
          now: new Date(expiredAt.getTime() + 1),
          leaseExpiresAt: new Date(expiredAt.getTime() + 30_000),
        }),
      ).resolves.toMatchObject({
        kind: 'claimed',
        item: { claimFence: freshFence, attemptOrdinal: 2, dispatchEpoch: 1 },
      })
    })

    it('reserves pending work and only processing claims whose lease has elapsed', async () => {
      await resetIntent()
      const claimFence = '20000000-0000-4000-8000-00000000000a'
      const leaseExpiresAt = new Date(NOW.getTime() + 60_000)
      await expect(store.reserveDueItems(NOW, 100)).resolves.toMatchObject([
        { itemId: ITEM_ID, status: 'pending', claimFence: null, dispatchEpoch: 0 },
      ])
      await expect(store.reserveDueItems(NOW, 100)).resolves.toEqual([])
      await expect(
        store.claimItem({
          organizationId: ORG_ID,
          itemId: ITEM_ID,
          retryRevision: 0,
          dispatchEpoch: 0,
          attemptOrdinal: 1,
          claimFence,
          now: NOW,
          leaseExpiresAt,
        }),
      ).resolves.toMatchObject({ kind: 'claimed' })
      await expect(
        store.reserveDueItems(new Date(leaseExpiresAt.getTime() - 1), 100),
      ).resolves.toEqual([])
      await expect(store.reserveDueItems(leaseExpiresAt, 100)).resolves.toMatchObject([
        {
          organizationId: ORG_ID,
          itemId: ITEM_ID,
          retryRevision: 0,
          dispatchEpoch: 0,
          status: 'processing',
          claimFence,
          attemptOrdinal: 1,
          effectDeadlineAt: intent().items[0]!.effectDeadlineAt,
        },
      ])
      await expect(
        store.releaseClaimForRetry({
          organizationId: ORG_ID,
          itemId: ITEM_ID,
          retryRevision: 0,
          dispatchEpoch: 0,
          claimFence,
          now: leaseExpiresAt,
        }),
      ).resolves.toBe('released')
      await expect(store.reserveDueItems(leaseExpiresAt, 100)).resolves.toEqual([])
    })

    // Queue delivery ordinals can repeat after a death; durable acquisition
    // still spends the next attempt and rejects the previous claim fence.
    it('lets the stalled attempt take the item back after the reaper released its claim', async () => {
      await resetIntent()
      const deadFence = '20000000-0000-4000-8000-00000000000b'
      const recoveredFence = '20000000-0000-4000-8000-00000000000c'
      const leaseExpiresAt = new Date(NOW.getTime() + 60_000)
      await store.claimItem({
        dispatchEpoch: 0,
        organizationId: ORG_ID,
        itemId: ITEM_ID,
        retryRevision: 0,
        attemptOrdinal: 1,
        claimFence: deadFence,
        now: NOW,
        leaseExpiresAt,
      })

      await expect(reapAt(leaseExpiresAt)).resolves.toMatchObject({
        claimsReleased: 1,
        completionChecks: 0,
        itemsDispatched: 1,
      })

      const recoveredAt = new Date(leaseExpiresAt.getTime() + 30_000)
      await expect(
        store.claimItem({
          dispatchEpoch: 1,
          organizationId: ORG_ID,
          itemId: ITEM_ID,
          retryRevision: 0,
          attemptOrdinal: 1,
          claimFence: recoveredFence,
          now: recoveredAt,
          leaseExpiresAt: new Date(recoveredAt.getTime() + 60_000),
        }),
      ).resolves.toMatchObject({
        kind: 'claimed',
        item: { claimFence: recoveredFence, attemptOrdinal: 2, dispatchEpoch: 1 },
      })
      // The dead attempt's fence owns nothing any more.
      const effect = vi.fn(async () => 'must-not-run')
      await expect(
        store.runClaimedEffect(
          {
            dispatchEpoch: 0,
            organizationId: ORG_ID,
            itemId: ITEM_ID,
            retryRevision: 0,
            attemptOrdinal: 1,
            claimFence: deadFence,
            now: recoveredAt,
          },
          effect,
        ),
      ).resolves.toEqual({ kind: 'lost' })
      expect(effect).not.toHaveBeenCalled()
    })

    it('refuses a delivery generation older than the claim that was released', async () => {
      await resetIntent()
      const firstFence = '20000000-0000-4000-8000-00000000000d'
      const secondFence = '20000000-0000-4000-8000-00000000000e'
      const lease = (from: Date) => new Date(from.getTime() + 60_000)
      await store.claimItem({
        dispatchEpoch: 0,
        organizationId: ORG_ID,
        itemId: ITEM_ID,
        retryRevision: 0,
        attemptOrdinal: 1,
        claimFence: firstFence,
        now: NOW,
        leaseExpiresAt: lease(NOW),
      })
      await store.releaseClaimForRetry({
        dispatchEpoch: 0,
        organizationId: ORG_ID,
        itemId: ITEM_ID,
        retryRevision: 0,
        claimFence: firstFence,
        now: NOW,
      })
      await store.claimItem({
        dispatchEpoch: 1,
        organizationId: ORG_ID,
        itemId: ITEM_ID,
        retryRevision: 0,
        attemptOrdinal: 2,
        claimFence: secondFence,
        now: NOW,
        leaseExpiresAt: lease(NOW),
      })
      await store.releaseClaimForRetry({
        dispatchEpoch: 1,
        organizationId: ORG_ID,
        itemId: ITEM_ID,
        retryRevision: 0,
        claimFence: secondFence,
        now: NOW,
      })

      await expect(
        store.claimItem({
          dispatchEpoch: 0,
          organizationId: ORG_ID,
          itemId: ITEM_ID,
          retryRevision: 0,
          attemptOrdinal: 1,
          claimFence: '20000000-0000-4000-8000-00000000000f',
          now: NOW,
          leaseExpiresAt: lease(NOW),
        }),
      ).resolves.toEqual({ kind: 'ignored', reason: 'stale_dispatch' })
    })
  })

  describe('manual retry', () => {
    it('atomically accepts and exactly replays one authorized manual retry', async () => {
      await resetIntent()
      await expect(
        lifecycleTerminal('temporarily_unavailable', new Date(NOW.getTime() + 60_000)),
      ).resolves.toBe('completed')
      const digest = { keyVersion: 'v1', digest: 'C'.repeat(43) }
      const authorize = vi.fn(async () => 'authorized' as const)
      const retryAt = new Date(NOW.getTime() + 120_000)
      const retryInput = {
        organizationId: ORG_ID,
        initiatingUserId: USER_ID,
        itemId: ITEM_ID,
        retryRequestId: RETRY_REQUEST_ID,
        expectedRetryRevision: 0,
        requestDigest: digest,
        matchesRequestDigest: matchesDigest(digest),
        now: retryAt,
        authorize,
      }

      await expect(
        store.retryItem({ ...retryInput, outboxEventId: RETRY_OUTBOX_ID }),
      ).resolves.toEqual({ kind: 'accepted', importJobId: REQUEST_ID, retryRevision: 1 })
      expect(authorize).toHaveBeenCalledWith(
        expect.objectContaining({
          importJobId: REQUEST_ID,
          itemId: ITEM_ID,
          connectionId: CONNECTION_ID,
          authorization: expect.objectContaining({
            organizationId: ORG_ID,
            userId: USER_ID,
            connectionId: CONNECTION_ID,
          }),
        }),
      )

      await expect(readItem()).resolves.toMatchObject({
        status: 'pending',
        outcomeCode: null,
        retryRevision: 1,
        highestAttemptForRevision: 0,
        providerAccountSuffix: 'account-1',
        providerLocationSuffix: 'location-1',
        firstTerminalAt: new Date(NOW.getTime() + 60_000),
      })
      const [parent] = await db
        .select()
        .from(googleImports)
        .where(eq(googleImports.id, REQUEST_ID))
      expect(parent).toMatchObject({
        firstTerminalAt: new Date(NOW.getTime() + 60_000),
        purgeAt: new Date(NOW.getTime() + 30 * DAY_MS + 60_000),
      })
      await expect(
        db
          .select()
          .from(idempotencyReceipts)
          .where(
            and(
              eq(idempotencyReceipts.scope, 'gbp_import_item_retry'),
              eq(
                idempotencyReceipts.key,
                JSON.stringify([ORG_ID, USER_ID, ITEM_ID, RETRY_REQUEST_ID]),
              ),
            ),
          ),
      ).resolves.toHaveLength(1)
      await expect(
        db.select().from(outboxEvents).where(eq(outboxEvents.id, RETRY_OUTBOX_ID)),
      ).resolves.toHaveLength(1)

      authorize.mockClear()
      await expect(
        store.retryItem({
          ...retryInput,
          outboxEventId: '20000000-0000-4000-8000-000000000012',
        }),
      ).resolves.toEqual({ kind: 'replayed', importJobId: REQUEST_ID, retryRevision: 1 })
      expect(authorize).not.toHaveBeenCalled()
    })

    it('rejects mismatched replay hashes without mutating the accepted revision', async () => {
      await resetIntent()
      await lifecycleTerminal('temporarily_unavailable', new Date(NOW.getTime() + 60_000))
      const base = {
        organizationId: ORG_ID,
        initiatingUserId: USER_ID,
        itemId: ITEM_ID,
        retryRequestId: RETRY_REQUEST_ID,
        expectedRetryRevision: 0,
        now: new Date(NOW.getTime() + 120_000),
        outboxEventId: RETRY_OUTBOX_ID,
        authorize: vi.fn(async () => 'authorized' as const),
        matchesRequestDigest: matchesDigest({
          keyVersion: 'v1',
          digest: 'C'.repeat(43),
        }),
      }
      await store.retryItem({
        ...base,
        requestDigest: { keyVersion: 'v1', digest: 'C'.repeat(43) },
      })

      await expect(
        store.retryItem({
          ...base,
          matchesRequestDigest: matchesDigest({
            keyVersion: 'v1',
            digest: 'D'.repeat(43),
          }),
          requestDigest: { keyVersion: 'v1', digest: 'D'.repeat(43) },
          outboxEventId: '20000000-0000-4000-8000-000000000013',
        }),
      ).resolves.toEqual({ kind: 'rejected', reason: 'request_conflict' })
      expect(base.authorize).toHaveBeenCalledTimes(1)
      await expect(readItem()).resolves.toMatchObject({
        status: 'pending',
        retryRevision: 1,
      })
    })
  })

  describe('the Google primary category an item carries to its Property', () => {
    const CLAIM_FENCE = '20000000-0000-4000-8000-000000000020'
    const category = async () => (await readItem())?.googlePrimaryCategory

    it('is stored with the item and handed to the effect that creates the Property', async () => {
      await resetStorage()
      await expect(store.commitImport(intent(NOW, 'Boat rental service'))).resolves.toBe(
        'committed',
      )

      expect(await category()).toBe('Boat rental service')
      await expect(claim(CLAIM_FENCE)).resolves.toMatchObject({
        kind: 'claimed',
        item: { googlePrimaryCategory: 'Boat rental service' },
      })
    })

    it('is absent for an item written without one, and reaches the effect as null', async () => {
      await resetStorage()
      await expect(store.commitImport(intent(NOW))).resolves.toBe('committed')

      expect(await category()).toBeNull()
      await expect(claim(CLAIM_FENCE)).resolves.toMatchObject({
        kind: 'claimed',
        item: { googlePrimaryCategory: null },
      })
    })

    it('goes with the other provider state when the item ends, but not when it may be retried', async () => {
      await resetStorage()
      await expect(store.commitImport(intent(NOW, 'Day spa'))).resolves.toBe('committed')
      await expect(lifecycleTerminal('temporarily_unavailable')).resolves.toBe(
        'completed',
      )
      expect(await category()).toBe('Day spa')

      await resetStorage()
      await expect(store.commitImport(intent(NOW, 'Day spa'))).resolves.toBe('committed')
      await expect(lifecycleTerminal('authorization_changed')).resolves.toBe('completed')
      expect(await category()).toBeNull()
    })

    // The table refuses a category on a finished item, so the scrub can no
    // longer be shown taking one from a row that holds it; it must still
    // report the row it cleaned and leave none behind.
    it('is held by no finished item: the database refuses one and the scrub leaves none', async () => {
      await resetStorage()
      await expect(store.commitImport(intent(NOW, 'Day spa'))).resolves.toBe('committed')
      await lifecycleTerminal('authorization_changed')
      await expect(
        db
          .update(googleImportItems)
          .set({ googlePrimaryCategory: 'Day spa' })
          .where(eq(googleImportItems.id, ITEM_ID)),
      ).rejects.toMatchObject({
        cause: { constraint: 'google_import_items_checkpoint_state_valid' },
      })

      await expect(
        store.scrubLifecycleItems({
          organizationId: ORG_ID,
          itemIds: [ITEM_ID],
          now: NOW,
        }),
      ).resolves.toBe(1)
      expect(await category()).toBeNull()
    })

    it('is cleared by the lifecycle scrub of an item that ends in the same sweep', async () => {
      await resetStorage()
      await expect(store.commitImport(intent(NOW, 'Day spa'))).resolves.toBe('committed')
      await lifecycleTerminal('user_cancelled')

      await expect(
        store.scrubLifecycleItems({
          organizationId: ORG_ID,
          itemIds: [ITEM_ID],
          now: NOW,
        }),
      ).resolves.toBe(1)

      expect(await category()).toBeNull()
    })

    it('is refused by the database when it is empty, padded or too long to be a category', async () => {
      await resetStorage()
      await expect(store.commitImport(intent(NOW, 'Day spa'))).resolves.toBe('committed')

      for (const value of ['', ' Day spa', 'Day spa ']) {
        await expect(
          db
            .update(googleImportItems)
            .set({ googlePrimaryCategory: value })
            .where(eq(googleImportItems.id, ITEM_ID)),
        ).rejects.toMatchObject({
          cause: { constraint: 'google_import_items_google_primary_category_valid' },
        })
      }
      // Past the column's own length the column refuses it before the check does.
      await expect(
        db
          .update(googleImportItems)
          .set({ googlePrimaryCategory: 'x'.repeat(513) })
          .where(eq(googleImportItems.id, ITEM_ID)),
      ).rejects.toMatchObject({ cause: { code: '22001' } })
      expect(await category()).toBe('Day spa')
    })
  })

  describe('the outcome detail an ended item records', () => {
    it('names the rejected profile field on a terminal tenant_profile_invalid item', async () => {
      await resetIntent()
      const terminal = await claimForTerminal('20000000-0000-4000-8000-000000000015')

      await expect(
        store.completeClaim({
          dispatchEpoch: 0,
          ...terminal,
          outcomeCode: 'tenant_profile_invalid',
        }),
      ).rejects.toThrow(/requires the rejected profile field/)
      await expect(
        store.completeClaim({
          dispatchEpoch: 0,
          ...terminal,
          outcomeCode: 'internal_error',
          detail: { kind: 'invalid_profile_field', field: 'name' },
        }),
      ).rejects.toThrow(/cannot carry this detail/)
      await expect(
        store.completeClaim({
          dispatchEpoch: 0,
          ...terminal,
          outcomeCode: 'tenant_profile_invalid',
          detail: { kind: 'invalid_profile_field', field: 'timezone' },
        }),
      ).resolves.toBe('completed')

      await expect(readItem()).resolves.toMatchObject({
        status: 'failed',
        outcomeCode: 'tenant_profile_invalid',
        invalidProfileField: 'timezone',
        destinationPropertyId: null,
        connectionId: null,
        providerAccountSuffix: null,
        providerLocationSuffix: null,
      })
      const progress = await store.getProgress(ORG_ID, USER_ID, REQUEST_ID)
      expect(progress).toMatchObject({ status: 'failed', canRetry: false })
      expect(progress?.items[0]).toMatchObject({
        status: 'failed',
        outcomeCode: 'tenant_profile_invalid',
        invalidProfileField: 'timezone',
        retryable: false,
        propertyId: null,
      })

      // The schema refuses a field on any other outcome, and any other field.
      await expect(
        db
          .update(googleImportItems)
          .set({ outcomeCode: 'internal_error' })
          .where(eq(googleImportItems.id, ITEM_ID)),
      ).rejects.toMatchObject({
        cause: {
          code: '23514',
          constraint: 'google_import_items_invalid_profile_field_valid',
        },
      })
      await expect(
        db
          .update(googleImportItems)
          .set({ invalidProfileField: 'slug' })
          .where(eq(googleImportItems.id, ITEM_ID)),
      ).rejects.toMatchObject({ cause: { code: '23514' } })
    })

    it('links an already_exists item to the Property that holds its location', async () => {
      await resetIntent()
      const existingPropertyId = '20000000-0000-4000-8000-000000000017'
      const terminal = await claimForTerminal('20000000-0000-4000-8000-000000000016')

      await expect(
        store.completeClaim({
          dispatchEpoch: 0,
          ...terminal,
          outcomeCode: 'internal_error',
          detail: { kind: 'existing_property', propertyId: existingPropertyId },
        }),
      ).rejects.toThrow(/cannot carry this detail/)
      await expect(
        store.completeClaim({
          dispatchEpoch: 0,
          ...terminal,
          outcomeCode: 'already_exists',
          detail: { kind: 'existing_property', propertyId: existingPropertyId },
        }),
      ).resolves.toBe('completed')

      await expect(readItem()).resolves.toMatchObject({
        status: 'already_exists',
        destinationPropertyId: existingPropertyId,
        invalidProfileField: null,
        connectionId: null,
        providerLocationSuffix: null,
      })
      const progress = await store.getProgress(ORG_ID, USER_ID, REQUEST_ID)
      expect(progress?.items[0]).toMatchObject({
        status: 'already_exists',
        propertyId: existingPropertyId,
        invalidProfileField: null,
      })

      // Deleting that Property finds and clears the reference like an import's.
      const propertyScope = {
        kind: 'property' as const,
        organizationId: ORG_ID,
        propertyId: existingPropertyId,
      }
      await expect(store.listLifecycleScopeItems(propertyScope, 100)).resolves.toEqual([
        {
          organizationId: ORG_ID,
          importJobId: REQUEST_ID,
          itemId: ITEM_ID,
          retryRevision: 0,
          active: false,
        },
      ])
      await expect(
        store.scrubLifecycleItems({
          organizationId: ORG_ID,
          itemIds: [ITEM_ID],
          now: NOW,
        }),
      ).resolves.toBe(1)
      const afterSweep = await store.getProgress(ORG_ID, USER_ID, REQUEST_ID)
      expect(afterSweep?.items[0]).toMatchObject({
        status: 'already_exists',
        propertyId: null,
      })
    })

    it('records an already_exists item without a Property when none was named', async () => {
      await resetIntent()
      const terminal = await claimForTerminal('20000000-0000-4000-8000-000000000018')

      await expect(
        store.completeClaim({
          dispatchEpoch: 0,
          ...terminal,
          outcomeCode: 'already_exists',
        }),
      ).resolves.toBe('completed')

      const progress = await store.getProgress(ORG_ID, USER_ID, REQUEST_ID)
      expect(progress?.items[0]).toMatchObject({
        status: 'already_exists',
        propertyId: null,
      })
    })
  })

  describe('the item lifecycle', () => {
    it('fences scoped parents and scrubs cancelled item lifecycle authority', async () => {
      await resetIntent()
      const connectionScope = {
        kind: 'connection' as const,
        organizationId: ORG_ID,
        connectionId: CONNECTION_ID,
      }

      await expect(
        store.listLifecycleScopeParents(connectionScope, 100),
      ).resolves.toEqual([{ organizationId: ORG_ID, importJobId: REQUEST_ID }])
      await expect(
        store.fenceLifecycleParent({
          organizationId: ORG_ID,
          importJobId: REQUEST_ID,
          now: NOW,
        }),
      ).resolves.toBe('fenced')
      await expect(
        store.listLifecycleScopeParents(connectionScope, 100),
      ).resolves.toEqual([])
      await expect(store.listLifecycleScopeItems(connectionScope, 100)).resolves.toEqual([
        {
          organizationId: ORG_ID,
          importJobId: REQUEST_ID,
          itemId: ITEM_ID,
          retryRevision: 0,
          active: true,
        },
      ])

      await expect(lifecycleTerminal('authorization_changed')).resolves.toBe('completed')
      await expect(
        store.scrubLifecycleItems({
          organizationId: ORG_ID,
          itemIds: [ITEM_ID],
          now: NOW,
        }),
      ).resolves.toBe(1)

      const [parent] = await db
        .select()
        .from(googleImports)
        .where(eq(googleImports.id, REQUEST_ID))
      expect(parent).toMatchObject({ deletionFence: 1 })
      await expect(readItem()).resolves.toMatchObject({
        status: 'cancelled',
        outcomeCode: 'authorization_changed',
        connectionId: null,
        existingPropertyId: null,
        destinationPropertyId: null,
        providerAccountSuffix: null,
        providerLocationSuffix: null,
        expectedConnectionLifecycleVersion: null,
        expectedConnectionAccessVersion: null,
        expectedCredentialGeneration: null,
        expectedSourceEpoch: null,
        expectedProfileVersion: null,
      })
    })

    it('keeps the produced Property on an imported item until its own deletion sweep', async () => {
      await resetIntent()
      await recordReceipt()

      await expect(
        store.reconcileFromReceipt({ organizationId: ORG_ID, itemId: ITEM_ID, now: NOW }),
      ).resolves.toBe('completed')

      // Provider identifiers and fences are gone; the Property reference stays
      // and the progress read hands it to the merchant.
      await expect(readItem()).resolves.toMatchObject({
        status: 'imported',
        destinationPropertyId: PROPERTY_ID,
        connectionId: null,
        providerAccountSuffix: null,
        providerLocationSuffix: null,
        expectedCredentialGeneration: null,
      })
      const progress = await store.getProgress(ORG_ID, USER_ID, REQUEST_ID)
      expect(progress?.items[0]).toMatchObject({
        status: 'imported',
        propertyId: PROPERTY_ID,
      })

      // A connection or user sweep holds no authority over a plain reference.
      for (const scope of [
        {
          kind: 'connection' as const,
          organizationId: ORG_ID,
          connectionId: CONNECTION_ID,
        },
        { kind: 'user' as const, organizationId: ORG_ID, userId: USER_ID },
      ]) {
        await expect(store.listLifecycleScopeItems(scope, 100)).resolves.toEqual([])
        await expect(store.countLifecycleScopeItems(scope, 100)).resolves.toBe(0)
      }

      // Deleting the Property must still find and clear the reference.
      const propertyScope = {
        kind: 'property' as const,
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
      }
      await expect(store.listLifecycleScopeItems(propertyScope, 100)).resolves.toEqual([
        {
          organizationId: ORG_ID,
          importJobId: REQUEST_ID,
          itemId: ITEM_ID,
          retryRevision: 0,
          active: false,
        },
      ])
      await expect(
        store.scrubLifecycleItems({
          organizationId: ORG_ID,
          itemIds: [ITEM_ID],
          now: NOW,
        }),
      ).resolves.toBe(1)
      await expect(store.listLifecycleScopeItems(propertyScope, 100)).resolves.toEqual([])
      const afterSweep = await store.getProgress(ORG_ID, USER_ID, REQUEST_ID)
      expect(afterSweep?.items[0]).toMatchObject({ status: 'imported', propertyId: null })
    })

    it('sweeps expired items and atomically releases retention before parent cascade', async () => {
      await resetIntent()
      const effectDeadline = intent().items[0]!.effectDeadlineAt

      await expect(
        store.listExpiredItems(new Date(effectDeadline.getTime() - 1), 100),
      ).resolves.toEqual([])
      await expect(store.listExpiredItems(effectDeadline, 100)).resolves.toEqual([
        { organizationId: ORG_ID, itemId: ITEM_ID, retryRevision: 0 },
      ])

      await expect(
        store.terminalizeItem({
          authority: { kind: 'lifecycle' },
          organizationId: ORG_ID,
          itemId: ITEM_ID,
          retryRevision: 0,
          outcomeCode: 'internal_error',
          retainRetryState: false,
          now: effectDeadline,
        }),
      ).resolves.toBe('completed')

      const purgeAt = new Date(effectDeadline.getTime() + 30 * DAY_MS)
      await expect(
        store.listPurgeCandidates(new Date(purgeAt.getTime() - 1), 100),
      ).resolves.toEqual([])
      await expect(store.listPurgeCandidates(purgeAt, 100)).resolves.toEqual([
        { organizationId: ORG_ID, importJobId: REQUEST_ID, deletionFence: 0 },
      ])

      await db.insert(idempotencyReceipts).values({
        scope: 'gbp_import_item_retry',
        key: JSON.stringify([ORG_ID, USER_ID, ITEM_ID, RETRY_REQUEST_ID]),
        payload: {
          organizationId: ORG_ID,
          initiatingUserId: USER_ID,
          itemId: ITEM_ID,
          retryRequestId: RETRY_REQUEST_ID,
          requestDigestKeyVersion: 'v1',
          requestDigest: 'C'.repeat(43),
          acceptedRetryRevision: 1,
        },
        recordedAt: effectDeadline,
      })
      const releaseEventId = '20000000-0000-4000-8000-000000000014'
      await expect(
        store.purgeParent({
          organizationId: ORG_ID,
          importJobId: REQUEST_ID,
          expectedDeletionFence: 0,
          now: purgeAt,
          outboxEventId: releaseEventId,
        }),
      ).resolves.toBe('purged')

      await expect(
        db.select().from(googleImports).where(eq(googleImports.id, REQUEST_ID)),
      ).resolves.toEqual([])
      await expect(
        db.select().from(googleImportItems).where(eq(googleImportItems.id, ITEM_ID)),
      ).resolves.toEqual([])
      await expect(
        db
          .select()
          .from(idempotencyReceipts)
          .where(
            and(
              eq(idempotencyReceipts.scope, 'gbp_import_item_retry'),
              sql`${idempotencyReceipts.payload}->>'itemId' = ${ITEM_ID}`,
            ),
          ),
      ).resolves.toEqual([])
      const [releaseEvent] = await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.id, releaseEventId))
      expect(releaseEvent).toMatchObject({
        eventType: 'integration.property_import.retention_released',
        eventVersion: 1,
        organizationId: ORG_ID,
        payload: {
          organizationId: ORG_ID,
          importJobId: REQUEST_ID,
          idempotencyKeys: [ITEM_ID],
        },
      })
    })
  })

  // Retryable outcomes retain their state to satisfy the real table CHECK.
  // Expired work can only resume through fresh discovery and confirmation.
  describe('an item the import cannot finish', () => {
    const deadline = () => intent().items[0]!.effectDeadlineAt
    const claimLastAttempt = async (at: Date) => {
      for (let attemptOrdinal = 1; attemptOrdinal <= 5; attemptOrdinal++) {
        const claimFence = `20000000-0000-4000-8000-0000000001${attemptOrdinal}0`
        await store.claimItem({
          dispatchEpoch: attemptOrdinal - 1,
          organizationId: ORG_ID,
          itemId: ITEM_ID,
          retryRevision: 0,
          attemptOrdinal,
          claimFence,
          now: at,
          leaseExpiresAt: new Date(at.getTime() + 60_000),
        })
        if (attemptOrdinal < 5) {
          await store.releaseClaimForRetry({
            dispatchEpoch: attemptOrdinal - 1,
            organizationId: ORG_ID,
            itemId: ITEM_ID,
            retryRevision: 0,
            claimFence,
            now: at,
          })
        }
      }
      return new Date(at.getTime() + 60_000)
    }
    const retry = (now: Date) =>
      store.retryItem({
        organizationId: ORG_ID,
        initiatingUserId: USER_ID,
        itemId: ITEM_ID,
        retryRequestId: RETRY_REQUEST_ID,
        expectedRetryRevision: 0,
        requestDigest: { keyVersion: 'v1', digest: 'C'.repeat(43) },
        now,
        outboxEventId: RETRY_OUTBOX_ID,
        matchesRequestDigest: matchesDigest({ keyVersion: 'v1', digest: 'C'.repeat(43) }),
        authorize: async () => 'authorized' as const,
      })

    it('offers fresh confirmation for an item that outlived its deadline', async () => {
      await resetIntent()
      const lifecycle = createGoogleImportLifecycle({
        store,
        propertyBindingApi: {
          sweepReleasedExpired: async () => 0,
          countUnreleasedExpired: async () => 0,
          cleanupOrganization: async () => 0,
        },
        clock: deadline,
        newEventId: () => randomUUID(),
      })

      await expect(lifecycle.sweep()).resolves.toMatchObject({
        expiredItemsVisited: 1,
        itemsTerminalized: 1,
      })

      await expect(readItem()).resolves.toMatchObject({
        status: 'failed',
        outcomeCode: 'temporarily_unavailable',
        connectionId: CONNECTION_ID,
        providerAccountSuffix: 'account-1',
        providerLocationSuffix: 'location-1',
      })
      await expect(store.getProgress(ORG_ID, USER_ID, REQUEST_ID)).resolves.toMatchObject(
        {
          canRetry: true,
          items: [expect.objectContaining({ retryable: true, userAction: 'retry' })],
        },
      )
      await expect(
        store.listRetryCandidates(ORG_ID, USER_ID, REQUEST_ID, deadline()),
      ).resolves.toMatchObject([{ itemId: ITEM_ID }])
      await expect(
        store.listRetryCandidates(ORG_ID, 'another-user', REQUEST_ID, deadline()),
      ).resolves.toEqual([])
      await expect(retry(deadline())).resolves.toEqual({
        kind: 'rejected',
        reason: 'effect_expired',
      })
      await expect(readItem()).resolves.toMatchObject({
        retryRevision: 0,
        effectDeadlineAt: deadline(),
      })
      await expect(
        db.select().from(outboxEvents).where(eq(outboxEvents.id, RETRY_OUTBOX_ID)),
      ).resolves.toEqual([])
    })

    it('keeps an item whose attempts ran out before its deadline retryable', async () => {
      await resetIntent()
      const leaseExpiresAt = await claimLastAttempt(NOW)

      await expect(reapAt(leaseExpiresAt)).resolves.toMatchObject({
        completionChecks: 1,
        claimsLost: 0,
      })
      await expect(readItem()).resolves.toMatchObject({
        status: 'failed',
        outcomeCode: 'temporarily_unavailable',
        connectionId: CONNECTION_ID,
        providerAccountSuffix: 'account-1',
        providerLocationSuffix: 'location-1',
      })
      await expect(retry(leaseExpiresAt)).resolves.toEqual({
        kind: 'accepted',
        importJobId: REQUEST_ID,
        retryRevision: 1,
      })
    })

    it('keeps an item whose attempts ran out past its deadline available for fresh confirmation', async () => {
      await resetIntent()
      const claimedAt = new Date(deadline().getTime() - 30_000)
      const leaseExpiresAt = await claimLastAttempt(claimedAt)

      await expect(reapAt(leaseExpiresAt)).resolves.toMatchObject({
        completionChecks: 1,
        claimsLost: 0,
      })
      await expect(readItem()).resolves.toMatchObject({
        status: 'failed',
        outcomeCode: 'temporarily_unavailable',
        connectionId: CONNECTION_ID,
        providerAccountSuffix: 'account-1',
      })
      await expect(retry(leaseExpiresAt)).resolves.toEqual({
        kind: 'rejected',
        reason: 'effect_expired',
      })
    })

    // A cancel that lands while the effect is in flight scrubs the item's
    // destination before the effect's receipt is read back. The receipt is the
    // proof the Property exists, so it must win over the cancel.
    it('adopts the receipt of an effect that committed after a cancel scrubbed the item', async () => {
      await resetIntent()
      await expect(lifecycleTerminal('user_cancelled')).resolves.toBe('completed')
      await expect(readItem()).resolves.toMatchObject({
        status: 'cancelled',
        destinationPropertyId: null,
      })

      await recordReceipt()
      await expect(
        store.reconcileFromReceipt({ organizationId: ORG_ID, itemId: ITEM_ID, now: NOW }),
      ).resolves.toBe('completed')

      await expect(readItem()).resolves.toMatchObject({
        status: 'imported',
        outcomeCode: 'imported',
        destinationPropertyId: PROPERTY_ID,
      })
    })

    // The same row shape reached another way: its Property was deleted and the
    // deletion sweep cleared the reference. That item is not a cancelled one.
    it('does not give a deleted Property back to an imported item whose reference was cleared', async () => {
      await resetIntent()
      await recordReceipt()
      await store.reconcileFromReceipt({
        organizationId: ORG_ID,
        itemId: ITEM_ID,
        now: NOW,
      })
      await store.scrubLifecycleItems({
        organizationId: ORG_ID,
        itemIds: [ITEM_ID],
        now: NOW,
      })

      await expect(
        store.reconcileFromReceipt({ organizationId: ORG_ID, itemId: ITEM_ID, now: NOW }),
      ).resolves.toBe('lost')

      await expect(readItem()).resolves.toMatchObject({
        status: 'imported',
        destinationPropertyId: null,
      })
    })

    it('still refuses a receipt that names a different Property than the item holds', async () => {
      await resetIntent()
      await recordReceipt(OTHER_PROPERTY_ID)

      await expect(
        store.reconcileFromReceipt({ organizationId: ORG_ID, itemId: ITEM_ID, now: NOW }),
      ).resolves.toBe('lost')

      await expect(readItem()).resolves.toMatchObject({
        status: 'pending',
        destinationPropertyId: PROPERTY_ID,
      })
    })

    // A caller that asks for a scrubbed `temporarily_unavailable` is told so
    // before the transaction, not by a CHECK violation that aborts a whole sweep
    // or reaper pass.
    it('refuses to scrub a retryable failure or to keep the state of a final one', async () => {
      await resetIntent()
      const claimFence = '20000000-0000-4000-8000-0000000001a0'
      await claim(claimFence)
      const settle = {
        organizationId: ORG_ID,
        itemId: ITEM_ID,
        retryRevision: 0,
        now: NOW,
      }

      await expect(
        store.terminalizeItem({
          authority: { kind: 'lifecycle' },
          ...settle,
          outcomeCode: 'temporarily_unavailable',
          retainRetryState: false,
        }),
      ).rejects.toThrow('protected google import state must survive retryable failure')
      await expect(
        store.completeClaim({
          dispatchEpoch: 0,
          ...settle,
          claimFence,
          outcomeCode: 'temporarily_unavailable',
          retainRetryState: false,
        }),
      ).rejects.toThrow('protected google import state must survive retryable failure')
      await expect(
        store.completeClaim({
          dispatchEpoch: 0,
          ...settle,
          claimFence,
          outcomeCode: 'internal_error',
          retainRetryState: true,
        }),
      ).rejects.toThrow(
        'protected google import state may only survive retryable failure',
      )
      await expect(readItem()).resolves.toMatchObject({
        status: 'processing',
        connectionId: CONNECTION_ID,
      })
    })
  })

  describe('who asked for a Property to be imported', () => {
    it('names the initiator of the import that produced the Property', async () => {
      await resetIntent()

      await expect(store.findPropertyImportInitiator(ORG_ID, PROPERTY_ID)).resolves.toBe(
        USER_ID,
      )
    })

    it('names nobody for a Property no import ever produced', async () => {
      await resetIntent()

      await expect(
        store.findPropertyImportInitiator(ORG_ID, OTHER_PROPERTY_ID),
      ).resolves.toBeNull()
    })

    it('does not answer across organizations', async () => {
      await resetIntent()

      await expect(
        store.findPropertyImportInitiator('another-organization', PROPERTY_ID),
      ).resolves.toBeNull()
    })

    it('names the first initiator when the Property was imported more than once', async () => {
      await resetIntent()
      const laterRequestId = '20000000-0000-4000-8000-0000000000a1'
      const laterItemId = '20000000-0000-4000-8000-0000000000a2'
      const later = intent(new Date(NOW.getTime() + 60_000))
      await expect(
        store.commitImport({
          ...later,
          id: laterRequestId,
          requestId: laterRequestId,
          initiatedBy: 'a-later-colleague',
          wireReplay: { keyVersion: 'v1', digest: 'C'.repeat(43) },
          semanticReplay: { keyVersion: 'v1', digest: 'D'.repeat(43) },
          items: [{ ...later.items[0]!, id: laterItemId }],
          outboxEventId: '20000000-0000-4000-8000-0000000000a3',
        }),
      ).resolves.toBe('committed')

      await expect(store.findPropertyImportInitiator(ORG_ID, PROPERTY_ID)).resolves.toBe(
        USER_ID,
      )
    })
  })
})
