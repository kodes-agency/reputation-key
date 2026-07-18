// BQC-3.5 — property command store integration tests (real Postgres).
//
// Crash-boundary proofs on the real properties table:
//   1. A forced outbox failure (unregistered fact type) rolls back EVERYTHING
//      — no property row survives.
//   2. Happy path: the state row and the outbox_events row commit together
//      with the same eventId.
//   3. The tenant guard holds on the real DB.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import type { EventBus } from '#/shared/events/event-bus'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { Property } from '../../domain/types'
import { propertyCreated, propertyDeleted, propertyUpdated } from '../../domain/events'
import { isPropertyError } from '../../domain/errors'
import { createAtomicPropertyCommandStore } from '../property-command-store'

const ORG_ID = organizationId('org-propcmd-0000-0000-0000-000000000001')
const PROP_ID = propertyId('4c000000-0000-0000-0000-000000000001')
const NOW = new Date('2026-06-01T12:00:00.000Z')

let pool: Pool
const db = getDb()

const silentEvents: EventBus = {
  on: () => {},
  emit: async () => {},
  clear: () => {},
}

function makeProperty(overrides: Partial<Property> = {}): Property {
  return {
    id: PROP_ID,
    organizationId: ORG_ID,
    name: 'Grand Hotel',
    slug: 'propcmd-grand-hotel',
    timezone: 'UTC',
    gbpPlaceId: null,
    googleConnectionId: null,
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
    processingRegion: 'unresolved',
    processingRegionSource: 'country_default',
    routingPolicyVersion: 1,
    processingRegionResolvedAt: null,
    sourceEpoch: 0,
    ...overrides,
  }
}

async function truncateAll(p: Pool) {
  await p.query('DELETE FROM properties WHERE organization_id = $1', [ORG_ID])
  await p.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG_ID])
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
})

afterAll(async () => {
  clearEventSchemas()
  await truncateAll(pool)
  await pool.query('DELETE FROM organization WHERE id = $1', [ORG_ID])
  await pool.end()
})

beforeEach(async () => {
  await truncateAll(pool)
})

describe.sequential('propertyCommandStore (integration)', () => {
  it('createProperty commits the property + created fact in one transaction', async () => {
    const store = createAtomicPropertyCommandStore(db, silentEvents)
    const property = makeProperty()
    const event = propertyCreated({
      propertyId: property.id,
      organizationId: property.organizationId,
      name: property.name,
      slug: property.slug,
      occurredAt: property.createdAt,
    })

    const inserted = await store.createProperty({
      organizationId: ORG_ID,
      property,
      event,
    })

    expect(inserted.id).toBe(PROP_ID)
    const rows = await pool.query('SELECT id, slug FROM properties WHERE id = $1', [
      PROP_ID,
    ])
    expect(rows.rows).toHaveLength(1)
    const facts = await pool.query(
      `SELECT id FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'property.created' AND id = $2`,
      [ORG_ID, event.eventId],
    )
    expect(facts.rows).toHaveLength(1)
  })

  it('createProperty rolls back the insert when the fact insert fails (unregistered type)', async () => {
    const store = createAtomicPropertyCommandStore(db, silentEvents)
    const ghost = {
      ...propertyCreated({
        propertyId: PROP_ID,
        organizationId: ORG_ID,
        name: 'Ghost',
        slug: 'propcmd-ghost',
        occurredAt: NOW,
      }),
      _tag: 'property.ghost',
    } as unknown as Parameters<typeof store.createProperty>[0]['event']

    await expect(
      store.createProperty({
        organizationId: ORG_ID,
        property: makeProperty({ slug: 'propcmd-ghost' }),
        event: ghost,
      }),
    ).rejects.toThrow()

    const rows = await pool.query(
      'SELECT id FROM properties WHERE organization_id = $1',
      [ORG_ID],
    )
    expect(rows.rows).toHaveLength(0)
  })

  it('createProperty enforces the tenant guard', async () => {
    const store = createAtomicPropertyCommandStore(db, silentEvents)

    await expect(
      store.createProperty({
        organizationId: organizationId('org-other-0000-0000-0000-000000000001'),
        property: makeProperty(),
        event: propertyCreated({
          propertyId: PROP_ID,
          organizationId: ORG_ID,
          name: 'Grand Hotel',
          slug: 'propcmd-grand-hotel',
          occurredAt: NOW,
        }),
      }),
    ).rejects.toSatisfy((e: unknown) => isPropertyError(e) && e.code === 'forbidden')
  })

  it('updateProperty commits the patch + updated fact in one transaction', async () => {
    const store = createAtomicPropertyCommandStore(db, silentEvents)
    await store.createProperty({
      organizationId: ORG_ID,
      property: makeProperty(),
      event: propertyCreated({
        propertyId: PROP_ID,
        organizationId: ORG_ID,
        name: 'Grand Hotel',
        slug: 'propcmd-grand-hotel',
        occurredAt: NOW,
      }),
    })

    const event = propertyUpdated({
      propertyId: PROP_ID,
      organizationId: ORG_ID,
      name: 'Renamed Hotel',
      slug: 'propcmd-renamed',
      occurredAt: NOW,
    })
    await store.updateProperty({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      patch: { name: 'Renamed Hotel', slug: 'propcmd-renamed', updatedAt: NOW },
      event,
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

  it('deleteProperty commits the delete + deleted fact in one transaction', async () => {
    const store = createAtomicPropertyCommandStore(db, silentEvents)
    await store.createProperty({
      organizationId: ORG_ID,
      property: makeProperty(),
      event: propertyCreated({
        propertyId: PROP_ID,
        organizationId: ORG_ID,
        name: 'Grand Hotel',
        slug: 'propcmd-grand-hotel',
        occurredAt: NOW,
      }),
    })

    const event = propertyDeleted({
      propertyId: PROP_ID,
      organizationId: ORG_ID,
      occurredAt: NOW,
    })
    await store.deleteProperty({ organizationId: ORG_ID, propertyId: PROP_ID, event })

    const rows = await pool.query('SELECT id FROM properties WHERE id = $1', [PROP_ID])
    expect(rows.rows).toHaveLength(0)
    const facts = await pool.query(
      `SELECT id FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'property.deleted' AND id = $2`,
      [ORG_ID, event.eventId],
    )
    expect(facts.rows).toHaveLength(1)
  })
})
