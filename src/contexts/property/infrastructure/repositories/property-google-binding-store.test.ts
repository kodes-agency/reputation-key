import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { DEFAULT_PROPERTY_GOOGLE_PROFILE, type Property } from '../../domain/types'
import { propertyDeleted, propertyGoogleBindingChanged } from '../../domain/events'
import {
  PROPERTY_OPERATION_RECEIPT_TTL_MS,
  PropertyGoogleBindingError,
} from '../../application/ports/property-google-binding.port'
import { createPropertyGoogleBindingStore } from '../property-google-binding-store'
import { createAtomicPropertyCommandStore } from '../property-command-store'
import { propertyToRow } from '../mappers/property.mapper'
import { properties } from '#/shared/db/schema/property.schema'

const ORG_ID = organizationId('org-google-binding-integration')
const OTHER_ORG_ID = organizationId('org-google-binding-other')
const NOW = new Date('2026-08-10T10:00:00.000Z')
const CONFIRMED_AT = new Date('2026-08-09T10:00:00.000Z')
const CONNECTION_ID = googleConnectionId('00000000-0000-4000-8000-000000000101')
const CONNECTION_ID_2 = googleConnectionId('00000000-0000-4000-8000-000000000102')

let pool: Pool
const db = getDb()

function makeProperty(idSuffix: string, overrides: Partial<Property> = {}): Property {
  const id = propertyId(`10000000-0000-4000-8000-${idSuffix.padStart(12, '0')}`)
  return {
    id,
    organizationId: ORG_ID,
    name: `Property ${idSuffix}`,
    slug: `binding-property-${idSuffix}`,
    timezone: 'America/New_York',
    ...DEFAULT_PROPERTY_GOOGLE_PROFILE,
    gbpLocationId: null,
    googleConnectionId: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    lifecycleState: 'active',
    lifecycleReason: null,
    lifecycleStateChangedAt: NOW,
    purgeScheduledFor: null,
    lifecycleInitiatedBy: null,
    responsibleManagerRevision: 1,
    responsibilityNeededSince: NOW,
    countryCode: null,
    countrySource: 'organization_default',
    timezoneSource: 'legacy',
    timezoneResolvedAt: null,
    sourceEpoch: 0,
    ...overrides,
  }
}

function makeActiveProperty(idSuffix: string, locationId: string): Property {
  return makeProperty(idSuffix, {
    address: '1 Main Street',
    gbpLocationId: locationId,
    gbpAccountId: 'account-1',
    googleConnectionId: CONNECTION_ID,
    googleBindingState: 'active',
    profileSource: 'tenant_confirmed',
    profileConfirmedAt: CONFIRMED_AT,
    profileConfirmedBy: 'user-1',
    sourceEpoch: 1,
    googleReviewDestination: {
      state: 'verified',
      uri: `https://search.google.com/local/writereview?placeid=${locationId}`,
      retrievedAt: CONFIRMED_AT,
      sourceEpoch: 1,
      profileVersion: 1,
    },
  })
}

async function cleanup(): Promise<void> {
  await pool.query('DELETE FROM property_operation_receipts WHERE organization_id = $1', [
    ORG_ID,
  ])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG_ID])
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG_ID])
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 4 })
  const client = await pool.connect()
  client.release()
  clearEventSchemas()
  registerAllEventSchemas()
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [ORG_ID, 'Google Binding Integration', 'google-binding-integration'],
  )
  await pool.query(
    `INSERT INTO google_connections (
       id, organization_id, google_subject,
       encrypted_access_token, encrypted_refresh_token, token_expires_at,
       scopes, connected_by, created_at, updated_at
     )
     VALUES
       ($1, $3, 'binding-subject-1', 'encrypted', 'encrypted', NOW(), ARRAY['https://www.googleapis.com/auth/business.manage'], 'user-1', NOW(), NOW()),
       ($2, $3, 'binding-subject-2', 'encrypted', 'encrypted', NOW(), ARRAY['https://www.googleapis.com/auth/business.manage'], 'user-2', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [CONNECTION_ID, CONNECTION_ID_2, ORG_ID],
  )
})

beforeEach(async () => {
  await cleanup()
})

afterAll(async () => {
  await cleanup()
  await pool.query('DELETE FROM google_connections WHERE organization_id = $1', [ORG_ID])
  await deleteTestOrganizations(pool, [ORG_ID])
  clearEventSchemas()
  await pool.end()
})

function bindingError(code: PropertyGoogleBindingError['code']) {
  return (error: unknown) =>
    error instanceof PropertyGoogleBindingError && error.code === code
}

describe.sequential('Property Google binding store', () => {
  it('atomically creates and exactly replays a confirmed binding receipt', async () => {
    const store = createPropertyGoogleBindingStore(db)
    const property = makeActiveProperty('1', 'location-1')
    const idempotencyKey = '20000000-0000-4000-8000-000000000001'

    const committed = await store.createBoundProperty({
      organizationId: ORG_ID,
      idempotencyKey,
      property,
      now: NOW,
    })
    const replayed = await store.createBoundProperty({
      organizationId: ORG_ID,
      idempotencyKey,
      property,
      now: new Date(NOW.getTime() + 1_000),
    })

    expect(committed).toEqual({
      propertyId: property.id,
      outcome: 'imported',
      sourceEpoch: 1,
      profileVersion: 1,
      replayed: false,
      tombstone: false,
    })
    expect(replayed).toEqual({ ...committed, replayed: true })

    const summary = await store.readSummary(ORG_ID, property.id)
    expect(summary).toEqual({
      state: 'active',
      sourceEpoch: 1,
      profileVersion: 1,
      profileSource: 'tenant_confirmed',
      profileConfirmedAt: CONFIRMED_AT,
    })
    expect(summary).not.toHaveProperty('connectionId')
    expect(summary).not.toHaveProperty('accountId')

    expect(summary).not.toHaveProperty('locationId')
    expect(await store.readSummary(OTHER_ORG_ID, property.id)).toBeNull()

    const receipt = await store.readReceipt(ORG_ID, idempotencyKey, NOW)
    expect(receipt?.expiresAt).toEqual(
      new Date(NOW.getTime() + PROPERTY_OPERATION_RECEIPT_TTL_MS),
    )
    expect(
      await store.readReceipt(
        ORG_ID,
        idempotencyKey,
        new Date(NOW.getTime() + PROPERTY_OPERATION_RECEIPT_TTL_MS),
      ),
    ).toBeNull()

    const outbox = await pool.query(
      `SELECT payload FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'property.google_binding.changed'`,
      [ORG_ID],
    )
    expect(outbox.rows).toHaveLength(1)
    expect(outbox.rows[0].payload).toMatchObject({
      organizationId: ORG_ID,
      propertyId: property.id,
      connectionId: CONNECTION_ID,
      sourceEpoch: 1,
      change: 'created',
    })
    expect(outbox.rows[0].payload).not.toHaveProperty('accountId')
    expect(outbox.rows[0].payload).not.toHaveProperty('locationId')
  })
  it('reads a bounded tenant-scoped import discovery view by location suffix', async () => {
    const store = createPropertyGoogleBindingStore(db)
    const property = makeActiveProperty('11', 'location-discovery')
    await store.createBoundProperty({
      organizationId: ORG_ID,
      idempotencyKey: '20000000-0000-4000-8000-000000000011',
      property,
      now: NOW,
    })

    await expect(
      store.readByLocationIds(ORG_ID, ['location-discovery', 'location-missing']),
    ).resolves.toEqual([
      {
        organizationId: ORG_ID,
        propertyId: property.id,
        state: 'active',
        connectionId: CONNECTION_ID,
        accountId: 'account-1',
        locationId: 'location-discovery',
        sourceEpoch: 1,
        profileVersion: 1,
        name: 'Property 11',
        address: '1 Main Street',
        countryCode: null,
        timezone: 'America/New_York',
        profileSource: 'tenant_confirmed',
        profileConfirmedAt: CONFIRMED_AT,
        lifecycleState: 'active',
        deletedAt: null,
        googleReviewDestination: {
          state: 'verified',
          uri: 'https://search.google.com/local/writereview?placeid=location-discovery',
          retrievedAt: CONFIRMED_AT,
          sourceEpoch: 1,
          profileVersion: 1,
        },
      },
    ])
    await expect(
      store.readByLocationIds(OTHER_ORG_ID, ['location-discovery']),
    ).resolves.toEqual([])
    await expect(store.readByLocationIds(ORG_ID, [])).rejects.toMatchObject({
      code: 'invalid_binding',
    })
    await expect(
      store.readByLocationIds(
        ORG_ID,
        Array.from({ length: 101 }, (_, index) => `l${index}`),
      ),
    ).rejects.toMatchObject({ code: 'invalid_binding' })
  })

  it('serializes duplicate active locations across concurrent creates', async () => {
    const store = createPropertyGoogleBindingStore(db)
    const results = await Promise.allSettled([
      store.createBoundProperty({
        organizationId: ORG_ID,
        idempotencyKey: '20000000-0000-4000-8000-000000000002',
        property: makeActiveProperty('2', 'shared-location'),
        now: NOW,
      }),
      store.createBoundProperty({
        organizationId: ORG_ID,
        idempotencyKey: '20000000-0000-4000-8000-000000000003',
        property: makeActiveProperty('3', 'shared-location'),
        now: NOW,
      }),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected).toBeDefined()
    expect((rejected as PromiseRejectedResult).reason).toSatisfy(
      bindingError('location_already_bound'),
    )
  })

  it('relinks with source/profile CAS, confirmed profile replacement, and exact replay', async () => {
    const store = createPropertyGoogleBindingStore(db)
    const property = makeActiveProperty('4', 'old-location')
    const disconnected = {
      ...property,
      googleBindingState: 'disconnected' as const,
      sourceEpoch: 4,
      profileVersion: 3,
    }
    await db.insert(properties).values(propertyToRow(disconnected))

    const input = {
      organizationId: ORG_ID,
      propertyId: property.id,
      idempotencyKey: '20000000-0000-4000-8000-000000000004',
      connectionId: CONNECTION_ID_2,
      accountId: 'account-2',
      locationId: 'location-2',
      profile: {
        name: '  Confirmed Name  ',
        address: '  2 Main Street  ',
        timezone: 'America/Chicago',
        confirmedBy: 'user-2',
        googleReviewUri: 'https://search.google.com/local/writereview?placeid=location-2',
      },
      expectedSourceEpoch: 4,
      expectedProfileVersion: 3,
      now: NOW,
    } as const

    const committed = await store.relink(input)
    const replayed = await store.relink(input)
    expect(committed).toMatchObject({
      outcome: 'relinked',
      sourceEpoch: 5,
      profileVersion: 4,
      replayed: false,
    })
    expect(replayed).toEqual({ ...committed, replayed: true })

    const current = await store.readInternal(ORG_ID, property.id)
    expect(current).toMatchObject({
      state: 'active',
      accountId: 'account-2',
      locationId: 'location-2',
      sourceEpoch: 5,
      profileVersion: 4,
      profileSource: 'tenant_confirmed',
      profileConfirmedAt: NOW,
      googleReviewDestination: {
        state: 'verified',
        uri: 'https://search.google.com/local/writereview?placeid=location-2',
        retrievedAt: NOW,
        sourceEpoch: 5,
        profileVersion: 4,
      },
    })
    const row = await pool.query(
      `SELECT name, address, timezone, timezone_source, profile_confirmed_by
       FROM properties WHERE organization_id = $1 AND id = $2`,
      [ORG_ID, property.id],
    )
    expect(row.rows[0]).toEqual({
      name: 'Confirmed Name',
      address: '2 Main Street',
      timezone: 'America/Chicago',
      timezone_source: 'tenant_confirmed',
      profile_confirmed_by: 'user-2',
    })

    await expect(
      store.relink({
        ...input,
        idempotencyKey: '20000000-0000-4000-8000-000000000005',
      }),
    ).rejects.toSatisfy(bindingError('stale_binding'))
    await expect(
      store.relink({
        ...input,
        idempotencyKey: '20000000-0000-4000-8000-000000000006',
        expectedSourceEpoch: 5,
        expectedProfileVersion: 4,
      }),
    ).rejects.toSatisfy(bindingError('active_binding_conflict'))
  })

  it('disconnects then scrubs provider identity while preserving profile generations', async () => {
    const store = createPropertyGoogleBindingStore(db)
    const property = makeActiveProperty('5', 'location-5')
    await db.insert(properties).values(propertyToRow(property))

    const disconnected = await store.disconnect({
      organizationId: ORG_ID,
      propertyId: property.id,
      expectedSourceEpoch: 1,
      expectedProfileVersion: 1,
      now: NOW,
    })
    expect(disconnected).toMatchObject({
      state: 'disconnected',
      sourceEpoch: 2,
      profileVersion: 1,
    })
    expect(await store.readInternal(ORG_ID, property.id)).toMatchObject({
      googleReviewDestination: {
        state: 'awaiting_refresh',
        uri: 'https://search.google.com/local/writereview?placeid=location-5',
      },
    })
    expect(
      await store.disconnect({
        organizationId: ORG_ID,
        propertyId: property.id,
        expectedSourceEpoch: 1,
        expectedProfileVersion: 1,
        now: NOW,
      }),
    ).toEqual(disconnected)

    const scrubbed = await store.scrubProviderIdentity({
      organizationId: ORG_ID,
      propertyId: property.id,
      expectedSourceEpoch: 2,
      expectedProfileVersion: 1,
      now: NOW,
    })
    expect(scrubbed).toMatchObject({
      state: 'unbound',
      sourceEpoch: 3,
      profileVersion: 1,
    })
    expect(await store.readInternal(ORG_ID, property.id)).toMatchObject({
      state: 'unbound',
      connectionId: null,
      accountId: null,
      locationId: null,
      profileVersion: 1,
      googleReviewDestination: {
        state: 'unavailable',
        uri: null,
      },
    })
    const outbox = await pool.query(
      `SELECT payload->>'change' AS change
       FROM outbox_events
       WHERE organization_id = $1
         AND property_id = $2
         AND event_type = 'property.google_binding.changed'`,
      [ORG_ID, property.id],
    )
    expect(outbox.rows.map((row) => row.change).sort()).toEqual([
      'deletion_started',
      'disconnected',
    ])
  })

  it('turns receipts into deletion tombstones and sweeps only released expiries', async () => {
    const store = createPropertyGoogleBindingStore(db)
    const commandStore = createAtomicPropertyCommandStore(db)
    const deletedProperty = makeActiveProperty('6', 'location-6')
    const retainedProperty = makeActiveProperty('7', 'location-7')
    const deletedKey = '20000000-0000-4000-8000-000000000007'
    const retainedKey = '20000000-0000-4000-8000-000000000008'

    await store.createBoundProperty({
      organizationId: ORG_ID,
      idempotencyKey: deletedKey,
      property: deletedProperty,
      now: NOW,
    })
    await store.createBoundProperty({
      organizationId: ORG_ID,
      idempotencyKey: retainedKey,
      property: retainedProperty,
      now: NOW,
    })

    const deletionTime = new Date(NOW.getTime() + 1_000)
    await commandStore.deleteProperty({
      organizationId: ORG_ID,
      propertyId: deletedProperty.id,
      expectedSourceEpoch: deletedProperty.sourceEpoch,
      expectedProfileVersion: deletedProperty.profileVersion,
      event: propertyDeleted({
        organizationId: ORG_ID,
        propertyId: deletedProperty.id,
        occurredAt: deletionTime,
      }),
      bindingEvent: propertyGoogleBindingChanged({
        organizationId: ORG_ID,
        propertyId: deletedProperty.id,
        connectionId: CONNECTION_ID,
        sourceEpoch: 2,
        change: 'deletion_started',
        occurredAt: deletionTime,
      }),
    })

    expect(await store.readReceipt(ORG_ID, deletedKey, deletionTime)).toMatchObject({
      destinationPropertyId: null,
      outcome: 'property_deleted',
      destinationSourceEpoch: 2,
      tombstone: true,
    })
    expect(
      await store.createBoundProperty({
        organizationId: ORG_ID,
        idempotencyKey: deletedKey,
        property: deletedProperty,
        now: deletionTime,
      }),
    ).toMatchObject({
      propertyId: null,
      outcome: 'property_deleted',
      replayed: true,
      tombstone: true,
    })

    const releaseEventId = '30000000-0000-4000-8000-000000000001'
    await pool.query(
      `INSERT INTO outbox_events (
         id, event_type, event_version, payload, organization_id,
         source_context, source_aggregate_id, created_at
       ) VALUES ($1, $2, 1, $3::jsonb, $4, 'integration', $6, $5)`,
      [
        releaseEventId,
        'integration.property_import.retention_released',
        JSON.stringify({ organizationId: ORG_ID, idempotencyKeys: [deletedKey] }),
        ORG_ID,
        deletionTime,
        releaseEventId,
      ],
    )
    const releaseInput = {
      eventId: releaseEventId,
      organizationId: ORG_ID,
      idempotencyKeys: [deletedKey, deletedKey],
      releasedAt: deletionTime,
    } as const
    expect(await store.releaseRetentionFromEvent(releaseInput)).toBe('applied')
    expect(await store.releaseRetentionFromEvent(releaseInput)).toBe('duplicate')
    const consumerReceipts = await pool.query(
      `SELECT status FROM event_consumer_receipts
       WHERE event_id = $1 AND consumer_name = 'property.import-retention-release'`,
      [releaseEventId],
    )
    expect(consumerReceipts.rows).toEqual([{ status: 'applied' }])
    expect(
      await store.countUnreleasedExpired({
        now: new Date(NOW.getTime() + PROPERTY_OPERATION_RECEIPT_TTL_MS - 1),
        limit: 100,
      }),
    ).toBe(0)
    expect(
      await store.countUnreleasedExpired({
        now: new Date(NOW.getTime() + PROPERTY_OPERATION_RECEIPT_TTL_MS),
        limit: 100,
      }),
    ).toBe(1)
    expect(
      await store.sweepReleasedExpired({
        now: new Date(NOW.getTime() + PROPERTY_OPERATION_RECEIPT_TTL_MS - 1),
        limit: 100,
      }),
    ).toBe(0)
    expect(
      await store.sweepReleasedExpired({
        now: new Date(NOW.getTime() + PROPERTY_OPERATION_RECEIPT_TTL_MS),
        limit: 100,
      }),
    ).toBe(1)

    const receiptRows = await pool.query(
      'SELECT idempotency_key FROM property_operation_receipts WHERE organization_id = $1',
      [ORG_ID],
    )
    expect(receiptRows.rows).toEqual([{ idempotency_key: retainedKey }])
    expect(await store.cleanupOrganization(ORG_ID)).toBe(1)
  })
})
