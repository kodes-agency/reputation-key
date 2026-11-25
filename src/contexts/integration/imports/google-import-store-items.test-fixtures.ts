import { replyScopeEffects } from '#/contexts/reputation/public-api'
import { fixHistoryCutoff } from '#/contexts/reputation/sync/review-provider-snapshot-repository.server'
import { buildGoogleImportedProperty } from '#/contexts/property/public-api'
import { organizationId, propertyId, googleConnectionId } from '#/shared/domain/ids'
import { GOOGLE_BUSINESS_MANAGE_SCOPE } from '#/contexts/integration/provider/contracts'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, vi } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { seedGoogleConnection } from '#/shared/testing/google-connection-seed'
import { drizzleSeedRunner } from '#/shared/db/testing/drizzle-seed-runner'
import { createDatabase, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { googleImportItems, googleImports } from '#/shared/db/schema/google-import.schema'
import { workItems } from '#/shared/db/schema/work-items.schema'
import { googleConnections } from '#/shared/db/schema/google-connection.schema'
import { idempotencyReceipts, outboxEvents } from '#/shared/db/schema/outbox.schema'
import { properties } from '#/shared/db/schema/property.schema'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { createPropertyGoogleBindingStore } from '#/contexts/property/profile/google-binding-store.server'
import type { GoogleImportIntent } from '#/contexts/integration/imports/import-store.port.server'
import { createGoogleImportProcessor } from '#/contexts/integration/imports/google-import-processor.server'
import { createGoogleImportClaimReaper } from '#/contexts/integration/imports/google-import-claim-reaper.server'
import { createImportStore } from '#/contexts/integration/imports/import-store.server'

export const NOW = new Date('2026-08-12T10:00:00.000Z')
export const DAY_MS = 24 * 60 * 60 * 1_000
export const ORG_ID = 'google-import-items-org'
export const USER_ID = 'google-import-items-user'
export const REQUEST_ID = '20000000-0000-4000-8000-000000000001'
export const ITEM_ID = '20000000-0000-4000-8000-000000000002'
export const CONNECTION_ID = '20000000-0000-4000-8000-000000000003'
export const PROPERTY_ID = '20000000-0000-4000-8000-000000000004'
export const OUTBOX_ID = '20000000-0000-4000-8000-000000000005'
export const RETRY_REQUEST_ID = '20000000-0000-4000-8000-000000000010'
export const RETRY_OUTBOX_ID = '20000000-0000-4000-8000-000000000011'
export const OTHER_PROPERTY_ID = '20000000-0000-4000-8000-0000000000ff'

export const matchesDigest =
  (expected: Readonly<{ keyVersion: string; digest: string }>) =>
  (stored: Readonly<{ keyVersion: string; digest: string }>) =>
    stored.keyVersion === expected.keyVersion && stored.digest === expected.digest

export function intent(
  now = NOW,
  googlePrimaryCategory?: string | null,
): GoogleImportIntent {
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

type ClaimInput = Parameters<ReturnType<typeof createImportStore>['claimItem']>[0]
type ReleaseInput = Parameters<
  ReturnType<typeof createImportStore>['releaseClaimForRetry']
>[0]

/** Registers the database, store and organization setup for one suite and returns the handles and helpers its tests share. */
export function useImportStoreItemsSuite() {
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
  const claimAs = (
    input: Omit<ClaimInput, 'organizationId' | 'itemId' | 'retryRevision'>,
  ) =>
    store.claimItem({
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      retryRevision: 0,
      ...input,
    })
  const release = (
    input: Omit<ReleaseInput, 'organizationId' | 'itemId' | 'retryRevision'>,
  ) =>
    store.releaseClaimForRetry({
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      retryRevision: 0,
      ...input,
    })
  const scrub = () =>
    store.scrubLifecycleItems({ organizationId: ORG_ID, itemIds: [ITEM_ID], now: NOW })
  const expectStaleEffectLost = async (claimFence: string, now: Date) => {
    const effect = vi.fn(async () => 'must-not-run')
    await expect(
      store.runClaimedEffect(
        {
          dispatchEpoch: 0,
          organizationId: ORG_ID,
          itemId: ITEM_ID,
          retryRevision: 0,
          attemptOrdinal: 1,
          claimFence,
          now,
        },
        effect,
      ),
    ).resolves.toEqual({ kind: 'lost' })
    expect(effect).not.toHaveBeenCalled()
  }

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
    await seedGoogleConnection(drizzleSeedRunner(db), {
      id: CONNECTION_ID,
      organizationId: ORG_ID,
      googleSubject: 'google-import-items-subject',
      accessToken: 'encrypted-access',
      refreshToken: 'encrypted-refresh',
      tokenExpiresAt: new Date(NOW.getTime() + DAY_MS),
      scopes: [GOOGLE_BUSINESS_MANAGE_SCOPE],
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

  return {
    get db() {
      return db
    },
    get store() {
      return store
    },
    get binding() {
      return binding
    },
    resetStorage,
    resetIntent,
    readItem,
    reapAt,
    recordReceipt,
    claim,
    claimForTerminal,
    lifecycleTerminal,
    claimAs,
    release,
    scrub,
    expectStaleEffectLost,
  }
}
