import type { Database } from '#/shared/db'
import {
  gbpImportRequestItems,
  gbpImportRequests,
} from '#/shared/db/schema/google-import-v2.schema'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import type { GoogleImportV2Intent } from '../application/ports/google-import-v2-store.port'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  createGoogleImportV2Store,
  googleImportProgressPollAfterMs,
} from './google-import-v2-store'

const NOW = new Date('2026-08-12T10:00:00.000Z')
registerAllEventSchemas()
const INTENT: GoogleImportV2Intent = {
  id: '00000000-0000-4000-8000-000000000001',
  organizationId: 'org-1',
  requestId: '00000000-0000-4000-8000-000000000002',
  initiatedBy: 'user-1',
  wireReplay: { keyVersion: 'v1', digest: 'A'.repeat(43) },
  semanticReplay: { keyVersion: 'v1', digest: 'B'.repeat(43) },
  items: [
    {
      id: '00000000-0000-4000-8000-000000000003',
      connectionId: '00000000-0000-4000-8000-000000000004',
      existingPropertyId: null,
      destinationPropertyId: '00000000-0000-4000-8000-000000000006',
      providerAccountSuffix: 'account-1',
      providerLocationSuffix: 'location-1',
      expectedConnectionLifecycleVersion: 1,
      expectedConnectionAccessVersion: 1,
      expectedCredentialGeneration: 1,
      authorization: {
        organizationId: 'org-1',
        userId: 'user-1',
        connectionId: '00000000-0000-4000-8000-000000000004',
        connectionLifecycleVersion: 1,
        connectionAccessVersion: 1,
        credentialGeneration: 1,
        approvalBindingId: 'approval-1',
        authorizationVector: {
          executionPolicyVersion: 'beta-local-2',
          googleContentPolicyVersion: 1,
          emergencyKillVersion: 1,
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
      processingRegion: 'us',
      routingPolicyVersion: 1,
      effectDeadlineAt: new Date('2026-08-13T10:00:00.000Z'),
    },
  ],
  now: NOW,
  outboxEventId: '00000000-0000-4000-8000-000000000005',
}

const createStore = (database: Database, clock: () => Date = () => NOW) =>
  createGoogleImportV2Store(database, clock)

type InsertRecord = Readonly<{ table: unknown; values: unknown }>

function transactionalDb(failTable?: unknown, failure?: unknown) {
  const committed: InsertRecord[] = []
  const database = {
    transaction: async (callback: (tx: unknown) => Promise<void>) => {
      const pending: InsertRecord[] = []
      const tx = {
        insert: (table: unknown) => ({
          values: async (values: unknown) => {
            if (table === failTable) throw failure ?? new Error('insert failed')
            pending.push({ table, values })
          },
        }),
      }
      await callback(tx)
      committed.push(...pending)
    },
  }
  return { database: database as Database, committed }
}

function selectingDb(results: readonly (readonly unknown[])[]) {
  let call = 0
  const database = {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = results[call++] ?? []
          const ordered = Object.assign(Promise.resolve(rows), {
            limit: async () => rows,
          })
          return {
            limit: async () => rows,
            orderBy: () => ordered,
          }
        },
      }),
    }),
  }
  return { database: database as unknown as Database, calls: () => call }
}

describe('Google import v2 store', () => {
  it('commits parent, items, and identifier-only outbox intent together', async () => {
    const fake = transactionalDb()
    const store = createStore(fake.database)

    await expect(store.commitIntent(INTENT)).resolves.toBe('committed')

    expect(fake.committed.map((entry) => entry.table)).toEqual([
      gbpImportRequests,
      gbpImportRequestItems,
      outboxEvents,
    ])
    expect(fake.committed[1]?.values).toEqual([
      expect.objectContaining({
        id: INTENT.items[0]!.id,
        destinationPropertyId: INTENT.items[0]!.destinationPropertyId,
        approvalBindingId: 'approval-1',
        expectedExecutionPolicyVersion: 'beta-local-2',
        expectedGoogleContentPolicyVersion: 1,
        expectedEmergencyKillVersion: 1,
        expectedActorRole: 'Admin',
        expectedPermissionDigest: 'a'.repeat(64),
      }),
    ])
    expect(fake.committed[1]?.values).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ authorization: expect.anything() }),
      ]),
    )
    expect(fake.committed[2]?.values).toEqual({
      id: INTENT.outboxEventId,
      eventType: 'integration.property_import.requested',
      eventVersion: 1,
      payload: {
        organizationId: INTENT.organizationId,
        importJobId: INTENT.id,
        correlationId: null,
      },
      organizationId: INTENT.organizationId,
      sourceContext: 'integration',
      propertyId: null,
      sourceAggregateId: INTENT.id,
      createdAt: NOW,
    })
  })

  it('rolls back every staged row when the outbox insert fails', async () => {
    const fake = transactionalDb(outboxEvents)
    const store = createStore(fake.database)

    await expect(store.commitIntent(INTENT)).rejects.toThrow('insert failed')
    expect(fake.committed).toEqual([])
  })

  it('maps direct and wrapped PostgreSQL uniqueness failures to conflict', async () => {
    const direct = transactionalDb(gbpImportRequests, { code: '23505' })
    const wrapped = transactionalDb(gbpImportRequests, {
      cause: { code: '23505' },
    })

    await expect(createStore(direct.database).commitIntent(INTENT)).resolves.toBe(
      'conflict',
    )
    await expect(createStore(wrapped.database).commitIntent(INTENT)).resolves.toBe(
      'conflict',
    )
    expect(direct.committed).toEqual([])
    expect(wrapped.committed).toEqual([])
  })

  it('loads only bounded pending dispatch facts after tenant-parent validation', async () => {
    const fake = selectingDb([
      [{ id: INTENT.id, status: 'queued' }],
      [
        {
          itemId: INTENT.items[0]!.id,
          expectedConnectionLifecycleVersion: 3,
          expectedSourceEpoch: 5,
          retryRevision: 2,
          processingRegion: 'us',
          routingPolicyVersion: 4,
        },
      ],
    ])
    const store = createStore(fake.database)

    await expect(
      store.listPendingDispatchItems(INTENT.organizationId, INTENT.id),
    ).resolves.toEqual([
      {
        itemId: INTENT.items[0]!.id,
        expectedConnectionLifecycleVersion: 3,
        expectedSourceEpoch: 5,
        retryRevision: 2,
        processingRegion: 'us',
        routingPolicyVersion: 4,
      },
    ])
    expect(fake.calls()).toBe(2)
  })

  it('distinguishes a missing parent and never reads child rows', async () => {
    const fake = selectingDb([[]])
    const store = createStore(fake.database)

    await expect(
      store.listPendingDispatchItems(INTENT.organizationId, INTENT.id),
    ).resolves.toBeNull()
    expect(fake.calls()).toBe(1)
  })

  it('does not dispatch pending-shaped rows from a terminal parent', async () => {
    const fake = selectingDb([[{ id: INTENT.id, status: 'cancelled' }]])
    const store = createStore(fake.database)

    await expect(
      store.listPendingDispatchItems(INTENT.organizationId, INTENT.id),
    ).resolves.toEqual([])
    expect(fake.calls()).toBe(1)
  })

  it('derives active progress polling from the injected clock', async () => {
    const pollNow = new Date('2099-01-01T12:00:00.000Z')
    const updatedAt = new Date(pollNow.getTime() - 30_000)
    let clockCalls = 0
    const fake = selectingDb([
      [],
      [
        {
          id: INTENT.id,
          requestId: INTENT.requestId,
          status: 'processing',
          totalCount: 1,
          processedCount: 0,
          pendingCount: 0,
          processingCount: 1,
          importedCount: 0,
          relinkedCount: 0,
          alreadyExistsCount: 0,
          regionUnavailableCount: 0,
          failedCount: 0,
          cancelledCount: 0,
          purgeAt: null,
          updatedAt,
        },
      ],
      [
        {
          id: INTENT.items[0]!.id,
          propertyName: INTENT.items[0]!.propertyName,
          action: 'create',
          status: 'processing',
          outcomeCode: null,
          connectionId: INTENT.items[0]!.connectionId,
          providerAccountSuffix: INTENT.items[0]!.providerAccountSuffix,
          providerLocationSuffix: INTENT.items[0]!.providerLocationSuffix,
          retryRevision: 0,
        },
      ],
    ])

    await expect(
      createStore(fake.database, () => {
        clockCalls += 1
        return pollNow
      }).getOperatorProgress(INTENT.organizationId, INTENT.id),
    ).resolves.toMatchObject({ pollAfterMs: 5_000, updatedAt: updatedAt.toISOString() })
    expect(clockCalls).toBe(1)
    expect(fake.calls()).toBe(3)
  })
})

describe('googleImportProgressPollAfterMs', () => {
  const NOW_MS = NOW.getTime()
  const staleBy = (ms: number) => NOW_MS - ms

  it('stops polling a terminal parent', () => {
    for (const status of [
      'completed',
      'completed_with_issues',
      'failed',
      'cancelled',
    ] as const) {
      expect(googleImportProgressPollAfterMs(status, staleBy(0), NOW_MS)).toBeNull()
    }
  })

  it.each([
    ['queued', 0, 1_000],
    ['processing', 29_999, 1_000],
    ['processing', 30_000, 5_000],
    ['queued', 119_999, 5_000],
    ['processing', 120_000, 15_000],
    // Hours of no movement never polls faster than the cap.
    ['processing', 6 * 60 * 60_000, 15_000],
  ] as const)(
    'backs off a %s parent stale by %ims to %ims',
    (status, stale, expected) => {
      expect(googleImportProgressPollAfterMs(status, staleBy(stale), NOW_MS)).toBe(
        expected,
      )
    },
  )

  it('is monotonic in staleness and never exceeds the cap', () => {
    let previous = 0
    for (const stale of [0, 1_000, 29_999, 30_000, 60_000, 120_000, 10 * 60_000]) {
      const interval = googleImportProgressPollAfterMs(
        'processing',
        staleBy(stale),
        NOW_MS,
      )!
      expect(interval).toBeGreaterThanOrEqual(previous)
      expect(interval).toBeLessThanOrEqual(15_000)
      previous = interval
    }
  })

  it('returns the fast interval for a clock-skewed future updatedAt', () => {
    expect(googleImportProgressPollAfterMs('processing', NOW_MS + 60_000, NOW_MS)).toBe(
      1_000,
    )
    expect(googleImportProgressPollAfterMs('processing', Number.NaN, NOW_MS)).toBe(1_000)
  })
})
