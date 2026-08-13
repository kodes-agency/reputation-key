import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  gbpImportItemRetryReceipts,
  gbpImportRequestItems,
  gbpImportRequests,
} from '#/shared/db/schema/google-import-v2.schema'
import { googleConnections } from '#/shared/db/schema/google-connection.schema'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import type { GoogleImportV2Intent } from '../application/ports/google-import-v2-store.port'
import { createGoogleImportV2Store } from './google-import-v2-store'

const NOW = new Date('2026-08-12T10:00:00.000Z')
const ORG_ID = 'google-import-v2-fence-org'
const USER_ID = 'google-import-v2-fence-user'
const REQUEST_ID = '10000000-0000-4000-8000-000000000001'
const ITEM_ID = '10000000-0000-4000-8000-000000000002'
const CONNECTION_ID = '10000000-0000-4000-8000-000000000003'
const PROPERTY_ID = '10000000-0000-4000-8000-000000000004'
const OUTBOX_ID = '10000000-0000-4000-8000-000000000005'
const RETRY_REQUEST_ID = '10000000-0000-4000-8000-000000000010'
const RETRY_OUTBOX_ID = '10000000-0000-4000-8000-000000000011'

const matchesDigest =
  (expected: Readonly<{ keyVersion: string; digest: string }>) =>
  (stored: Readonly<{ keyVersion: string; digest: string }>) =>
    stored.keyVersion === expected.keyVersion && stored.digest === expected.digest

function intent(now = NOW): GoogleImportV2Intent {
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
          approvalBindingId: 'approval-1',
          authorizationVector: {
            executionPolicyVersion: 1,
            googleContentPolicyVersion: 1,
            emergencyKillVersion: 1,
            role: 'Admin',
            permissionDigest: 'a'.repeat(64),
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
        processingRegion: 'us',
        routingPolicyVersion: 1,
        effectDeadlineAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
      },
    ],
    now,
    outboxEventId: OUTBOX_ID,
  }
}

describe('Google import v2 fenced store (real PostgreSQL)', () => {
  const db = getDb()
  const store = createGoogleImportV2Store(db)
  const clear = async () => {
    await db.delete(gbpImportRequests).where(eq(gbpImportRequests.organizationId, ORG_ID))
    await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORG_ID))
    await db.delete(googleConnections).where(eq(googleConnections.organizationId, ORG_ID))
    await db.execute(sql`DELETE FROM organization WHERE id = ${ORG_ID}`)
  }
  const resetIntent = async () => {
    await db.delete(gbpImportRequests).where(eq(gbpImportRequests.organizationId, ORG_ID))
    await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORG_ID))
    await expect(store.commitIntent(intent())).resolves.toBe('committed')
  }

  beforeAll(async () => {
    await clear()
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORG_ID}, 'Google import fence test', ${ORG_ID}, ${NOW})
    `)
    await db.insert(googleConnections).values({
      id: CONNECTION_ID,
      organizationId: ORG_ID,
      googleSubject: 'google-import-v2-fence-subject',
      encryptedAccessToken: 'encrypted-access',
      encryptedRefreshToken: 'encrypted-refresh',
      tokenExpiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1_000),
      scopes: ['https://www.googleapis.com/auth/business.manage'],
      connectedBy: USER_ID,
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  afterAll(clear)

  it('rejects duplicate claims and never invokes a stale fenced effect', async () => {
    await resetIntent()
    const firstFence = '10000000-0000-4000-8000-000000000006'
    const competingFence = '10000000-0000-4000-8000-000000000007'
    const leaseExpiresAt = new Date(NOW.getTime() + 30_000)

    await expect(
      store.claimItem({
        organizationId: ORG_ID,
        itemId: ITEM_ID,
        retryRevision: 0,
        attemptOrdinal: 1,
        claimFence: firstFence,
        now: NOW,
        leaseExpiresAt,
      }),
    ).resolves.toMatchObject({ kind: 'claimed' })
    await expect(
      store.claimItem({
        organizationId: ORG_ID,
        itemId: ITEM_ID,
        retryRevision: 0,
        attemptOrdinal: 1,
        claimFence: competingFence,
        now: NOW,
        leaseExpiresAt,
      }),
    ).resolves.toEqual({ kind: 'ignored', reason: 'claim_active' })

    const effect = vi.fn(async () => 'must-not-run')
    await expect(
      store.runClaimedEffect(
        {
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
    const staleFence = '10000000-0000-4000-8000-000000000008'
    const freshFence = '10000000-0000-4000-8000-000000000009'
    const expiredAt = new Date(NOW.getTime() + 1_000)

    await store.claimItem({
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
      item: { claimFence: freshFence, attemptOrdinal: 1 },
    })
  })
  it('atomically accepts and exactly replays one authorized manual retry', async () => {
    await resetIntent()
    await expect(
      store.terminalizeItem({
        organizationId: ORG_ID,
        itemId: ITEM_ID,
        retryRevision: 0,
        outcomeCode: 'temporarily_unavailable',
        retainProtectedRouting: true,
        now: new Date(NOW.getTime() + 60_000),
      }),
    ).resolves.toBe('completed')
    const digest = { keyVersion: 'v1', digest: 'C'.repeat(43) }
    const authorize = vi.fn(async () => 'authorized' as const)
    const retryAt = new Date(NOW.getTime() + 120_000)

    await expect(
      store.retryItem({
        organizationId: ORG_ID,
        initiatingUserId: USER_ID,
        itemId: ITEM_ID,
        retryRequestId: RETRY_REQUEST_ID,
        expectedRetryRevision: 0,
        requestDigest: digest,
        now: retryAt,
        outboxEventId: RETRY_OUTBOX_ID,
        matchesRequestDigest: matchesDigest(digest),
        authorize,
      }),
    ).resolves.toEqual({
      kind: 'accepted',
      importJobId: REQUEST_ID,
      retryRevision: 1,
    })
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

    const [item] = await db
      .select()
      .from(gbpImportRequestItems)
      .where(
        and(
          eq(gbpImportRequestItems.organizationId, ORG_ID),
          eq(gbpImportRequestItems.id, ITEM_ID),
        ),
      )
      .limit(1)
    expect(item).toMatchObject({
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
      .from(gbpImportRequests)
      .where(eq(gbpImportRequests.id, REQUEST_ID))
      .limit(1)
    expect(parent).toMatchObject({
      status: 'processing',
      pendingCount: 1,
      processedCount: 0,
      firstTerminalAt: new Date(NOW.getTime() + 60_000),
      purgeAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1_000 + 60_000),
    })
    await expect(
      db
        .select()
        .from(gbpImportItemRetryReceipts)
        .where(eq(gbpImportItemRetryReceipts.retryRequestId, RETRY_REQUEST_ID)),
    ).resolves.toHaveLength(1)
    await expect(
      db.select().from(outboxEvents).where(eq(outboxEvents.id, RETRY_OUTBOX_ID)),
    ).resolves.toHaveLength(1)

    authorize.mockClear()
    await expect(
      store.retryItem({
        organizationId: ORG_ID,
        initiatingUserId: USER_ID,
        itemId: ITEM_ID,
        retryRequestId: RETRY_REQUEST_ID,
        expectedRetryRevision: 0,
        requestDigest: digest,
        matchesRequestDigest: matchesDigest(digest),
        now: retryAt,
        outboxEventId: '10000000-0000-4000-8000-000000000012',
        authorize,
      }),
    ).resolves.toEqual({
      kind: 'replayed',
      importJobId: REQUEST_ID,
      retryRevision: 1,
    })
    expect(authorize).not.toHaveBeenCalled()
  })

  it('rejects mismatched replay hashes without mutating the accepted revision', async () => {
    await resetIntent()
    await store.terminalizeItem({
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      retryRevision: 0,
      outcomeCode: 'temporarily_unavailable',
      retainProtectedRouting: true,
      now: new Date(NOW.getTime() + 60_000),
    })
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
        outboxEventId: '10000000-0000-4000-8000-000000000013',
      }),
    ).resolves.toEqual({ kind: 'rejected', reason: 'request_conflict' })
    expect(base.authorize).toHaveBeenCalledTimes(1)
  })

  it('fences scoped parents and scrubs cancelled item lifecycle authority', async () => {
    await resetIntent()

    await expect(
      store.listLifecycleScopeParents(
        { kind: 'connection', organizationId: ORG_ID, connectionId: CONNECTION_ID },
        100,
      ),
    ).resolves.toEqual([{ organizationId: ORG_ID, importJobId: REQUEST_ID }])
    await expect(
      store.fenceLifecycleParent({
        organizationId: ORG_ID,
        importJobId: REQUEST_ID,
        now: NOW,
      }),
    ).resolves.toBe('fenced')
    await expect(
      store.listLifecycleScopeParents(
        { kind: 'connection', organizationId: ORG_ID, connectionId: CONNECTION_ID },
        100,
      ),
    ).resolves.toEqual([])
    await expect(
      store.listLifecycleScopeItems(
        { kind: 'connection', organizationId: ORG_ID, connectionId: CONNECTION_ID },
        100,
      ),
    ).resolves.toEqual([
      {
        organizationId: ORG_ID,
        importJobId: REQUEST_ID,
        itemId: ITEM_ID,
        retryRevision: 0,
        active: true,
      },
    ])

    await expect(
      store.terminalizeItem({
        organizationId: ORG_ID,
        itemId: ITEM_ID,
        retryRevision: 0,
        outcomeCode: 'authorization_changed',
        retainProtectedRouting: false,
        now: NOW,
      }),
    ).resolves.toBe('completed')
    await expect(
      store.scrubLifecycleItems({
        organizationId: ORG_ID,
        itemIds: [ITEM_ID],
        now: NOW,
      }),
    ).resolves.toBe(1)

    const [parent] = await db
      .select()
      .from(gbpImportRequests)
      .where(eq(gbpImportRequests.id, REQUEST_ID))
    expect(parent).toMatchObject({
      deletionFence: 1,
      wireReplayKeyVersion: null,
      wireReplayDigest: null,
      semanticReplayKeyVersion: null,
      semanticReplayDigest: null,
    })
    const [item] = await db
      .select()
      .from(gbpImportRequestItems)
      .where(eq(gbpImportRequestItems.id, ITEM_ID))
    expect(item).toMatchObject({
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

  it('sweeps expired items and atomically releases retention before parent cascade', async () => {
    await resetIntent()
    const effectDeadline = intent().items[0]!.effectDeadlineAt

    await expect(
      store.listExpiredItems(new Date(effectDeadline.getTime() - 1), 100),
    ).resolves.toEqual([])
    await expect(store.listExpiredItems(effectDeadline, 100)).resolves.toEqual([
      {
        organizationId: ORG_ID,
        itemId: ITEM_ID,
        retryRevision: 0,
      },
    ])

    await expect(
      store.terminalizeItem({
        organizationId: ORG_ID,
        itemId: ITEM_ID,
        retryRevision: 0,
        outcomeCode: 'internal_error',
        retainProtectedRouting: false,
        now: effectDeadline,
      }),
    ).resolves.toBe('completed')

    const purgeAt = new Date(effectDeadline.getTime() + 30 * 24 * 60 * 60 * 1_000)
    await expect(
      store.listPurgeCandidates(new Date(purgeAt.getTime() - 1), 100),
    ).resolves.toEqual([])
    await expect(store.listPurgeCandidates(purgeAt, 100)).resolves.toEqual([
      {
        organizationId: ORG_ID,
        importJobId: REQUEST_ID,
        deletionFence: 0,
      },
    ])

    await db.insert(gbpImportItemRetryReceipts).values({
      organizationId: ORG_ID,
      initiatingUserId: USER_ID,
      itemId: ITEM_ID,
      retryRequestId: RETRY_REQUEST_ID,
      requestDigestKeyVersion: 'v1',
      requestDigest: 'C'.repeat(43),
      acceptedRetryRevision: 1,
      createdAt: effectDeadline,
    })
    const releaseEventId = '10000000-0000-4000-8000-000000000014'
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
      db.select().from(gbpImportRequests).where(eq(gbpImportRequests.id, REQUEST_ID)),
    ).resolves.toEqual([])
    await expect(
      db
        .select()
        .from(gbpImportRequestItems)
        .where(eq(gbpImportRequestItems.id, ITEM_ID)),
    ).resolves.toEqual([])
    await expect(
      db
        .select()
        .from(gbpImportItemRetryReceipts)
        .where(eq(gbpImportItemRetryReceipts.itemId, ITEM_ID)),
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
        idempotencyKeys: [ITEM_ID],
      },
    })
  })
})
