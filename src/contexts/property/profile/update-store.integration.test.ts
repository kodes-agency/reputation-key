import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { seedTestProperty } from '../infrastructure/property-test-fixtures'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { DEFAULT_PROPERTY_GOOGLE_PROFILE, type Property } from '../domain/types'
import { propertyUpdated } from '../domain/events'
import { createAtomicPropertyCommandStore } from './update-store.server'

const ORG_ID = organizationId('org-propcmd-0000-0000-0000-000000000001')
const PROP_ID = propertyId('4c000000-0000-0000-0000-000000000001')
const OTHER_ORG_ID = organizationId('org-propcmd-0000-0000-0000-000000000002')
const OTHER_PROP_ID = propertyId('4c000000-0000-0000-0000-000000000002')
const NOW = new Date('2026-06-01T12:00:00.000Z')

let pool: Pool
const db = getDb()

function makeProperty(overrides: Partial<Property> = {}): Property {
  return {
    id: PROP_ID,
    organizationId: ORG_ID,
    name: 'Grand Hotel',
    slug: 'propcmd-grand-hotel',
    timezone: 'UTC',
    gbpLocationId: null,
    googleConnectionId: null,
    ...DEFAULT_PROPERTY_GOOGLE_PROFILE,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    lifecycleState: 'active',
    lifecycleReason: null,
    lifecycleStateChangedAt: NOW,
    purgeScheduledFor: null,
    lifecycleInitiatedBy: null,
    countryCode: null,
    countrySource: 'organization_default',
    timezoneSource: 'legacy',
    timezoneResolvedAt: null,
    sourceEpoch: 0,
    responsibleManagerRevision: 1,
    responsibilityNeededSince: NOW,
    ...overrides,
  }
}

async function truncateAll(p: Pool) {
  for (const org of [ORG_ID, OTHER_ORG_ID]) {
    await p.query('DELETE FROM properties WHERE organization_id = $1', [org])
    await p.query('DELETE FROM outbox_events WHERE organization_id = $1', [org])
  }
}

beforeAll(async () => {
  const env = getEnv()
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 })
  const client = await pool.connect()
  client.release()
  clearEventSchemas()
  registerAllEventSchemas()
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [ORG_ID, 'Property Cmd Org', 'propcmd-org'],
  )
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [OTHER_ORG_ID, 'Property Cmd Other Org', 'propcmd-other-org'],
  )
})

afterAll(async () => {
  clearEventSchemas()
  await truncateAll(pool)
  await deleteTestOrganizations(pool, [ORG_ID, OTHER_ORG_ID])
  await pool.end()
})

beforeEach(async () => {
  await truncateAll(pool)
})

describe.sequential('propertyCommandStore (integration)', () => {
  it('updateProperty commits the patch + updated fact in one transaction', async () => {
    const store = createAtomicPropertyCommandStore(db)
    await seedTestProperty(db, makeProperty())

    const event = propertyUpdated({
      propertyId: PROP_ID,
      organizationId: ORG_ID,
      name: 'Renamed Hotel',
      slug: 'propcmd-renamed',
      occurredAt: NOW,
    })
    const committed = await store.updateProperty({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      expectedSourceEpoch: 0,
      expectedProfileVersion: 1,
      patch: { name: 'Renamed Hotel', slug: 'propcmd-renamed', updatedAt: NOW },
      event: () => event,
    })

    // The store answers with the row as committed: patched and untouched columns.
    expect(committed).toMatchObject({
      id: PROP_ID,
      name: 'Renamed Hotel',
      slug: 'propcmd-renamed',
      timezone: 'UTC',
      profileVersion: 1,
    })
    const rows = await pool.query('SELECT name, slug FROM properties WHERE id = $1', [
      PROP_ID,
    ])
    expect(rows.rows[0]).toEqual({ name: 'Renamed Hotel', slug: 'propcmd-renamed' })
    const facts = await pool.query(
      `SELECT id FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'property.updated' AND id = $2`,
      [ORG_ID, event.eventId],
    )
    expect(facts.rows).toHaveLength(1)
  })
  const updatedFact = () =>
    propertyUpdated({
      propertyId: PROP_ID,
      organizationId: ORG_ID,
      name: 'Renamed Hotel',
      slug: 'propcmd-renamed',
      occurredAt: NOW,
    })

  it('leaves a column alone when the patch leaves it undefined', async () => {
    const store = createAtomicPropertyCommandStore(db)
    await seedTestProperty(db, makeProperty({ address: '1 Quay Street' }))

    await store.updateProperty({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      expectedSourceEpoch: 0,
      expectedProfileVersion: 1,
      patch: { name: 'Renamed Hotel', address: undefined, updatedAt: NOW },
      event: updatedFact,
    })

    const rows = await pool.query('SELECT name, address FROM properties WHERE id = $1', [
      PROP_ID,
    ])
    expect(rows.rows[0]).toEqual({ name: 'Renamed Hotel', address: '1 Quay Street' })
  })

  it('never sets identity columns, even when the patch names them', async () => {
    const store = createAtomicPropertyCommandStore(db)
    await seedTestProperty(db, makeProperty())

    await store.updateProperty({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      expectedSourceEpoch: 0,
      expectedProfileVersion: 1,
      patch: {
        name: 'Renamed Hotel',
        id: OTHER_PROP_ID,
        organizationId: OTHER_ORG_ID,
        createdAt: new Date('2020-01-01T00:00:00.000Z'),
      },
      event: updatedFact,
    })

    const rows = await pool.query(
      'SELECT id, organization_id, name, created_at FROM properties WHERE id = $1',
      [PROP_ID],
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]).toMatchObject({
      id: PROP_ID,
      organization_id: ORG_ID,
      name: 'Renamed Hotel',
      created_at: NOW,
    })
  })

  it("refuses another organization's Property and leaves it untouched", async () => {
    const store = createAtomicPropertyCommandStore(db)
    await seedTestProperty(
      db,
      makeProperty({
        id: OTHER_PROP_ID,
        organizationId: OTHER_ORG_ID,
        slug: 'propcmd-other',
        name: 'Other Hotel',
      }),
    )

    await expect(
      store.updateProperty({
        organizationId: ORG_ID,
        propertyId: OTHER_PROP_ID,
        expectedSourceEpoch: 0,
        expectedProfileVersion: 1,
        patch: { name: 'Taken Over', updatedAt: NOW },
        event: updatedFact,
      }),
    ).rejects.toMatchObject({ code: 'stale_property' })

    const rows = await pool.query('SELECT name FROM properties WHERE id = $1', [
      OTHER_PROP_ID,
    ])
    expect(rows.rows[0]).toEqual({ name: 'Other Hotel' })
    const facts = await pool.query(
      'SELECT id FROM outbox_events WHERE organization_id = $1',
      [OTHER_ORG_ID],
    )
    expect(facts.rows).toHaveLength(0)
  })

  it('rolls the profile write back when the fact cannot be recorded', async () => {
    const store = createAtomicPropertyCommandStore(db)
    await seedTestProperty(db, makeProperty())

    await expect(
      store.updateProperty({
        organizationId: ORG_ID,
        propertyId: PROP_ID,
        expectedSourceEpoch: 0,
        expectedProfileVersion: 1,
        patch: { name: 'Renamed Hotel', updatedAt: NOW },
        event: () => {
          throw new Error('fact refused')
        },
      }),
    ).rejects.toThrow('fact refused')

    const rows = await pool.query('SELECT name FROM properties WHERE id = $1', [PROP_ID])
    expect(rows.rows[0]).toEqual({ name: 'Grand Hotel' })
  })
})
