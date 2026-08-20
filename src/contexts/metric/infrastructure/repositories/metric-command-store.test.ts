// BQC-3.5 — metric command store integration tests (real Postgres).
//
// Crash-boundary proofs on the real metric_readings table:
//   1. A forced outbox failure (unregistered fact type) rolls back EVERYTHING
//      — no reading row survives.
//   2. Happy path: the reading row and the outbox_events row commit together
//      with the same eventId, and the fact's readingId matches the row id
//      (the store inserts the use-case-assigned id explicitly).

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import type { EventBus } from '#/shared/events/event-bus'
import { organizationId, propertyId, metricReadingId } from '#/shared/domain/ids'
import { createReading, type MetricReading } from '../../domain/metric-reading'
import { metricRecorded, type MetricRecorded } from '../../domain/events'
import { createAtomicMetricCommandStore } from '../metric-command-store'

const ORG_ID = organizationId('org-metriccmd-0000-0000-0000-000000000001')
const PROP_ID = propertyId('4d000000-0000-0000-0000-000000000001')
const READING_ID = metricReadingId('4e000000-0000-0000-0000-000000000001')
const NOW = new Date('2026-06-01T12:00:00.000Z')

let pool: Pool
const db = getDb()

const silentEvents: EventBus = {
  on: () => {},
  emit: async () => {},
  clear: () => {},
}

function makeReading(overrides: Partial<MetricReading> = {}): MetricReading {
  return createReading({
    id: READING_ID,
    definitionVersionId: '11111111-1111-4111-8111-111111111205',
    metricKey: 'property.review',
    organizationId: ORG_ID,
    propertyId: PROP_ID,
    portalId: null,
    portalGroupId: null,
    value: 4,
    sampleCount: 1,
    sourceEventId: 'integration-source-event-1',
    sourcePolicy: 'google_property_derivative',
    occurredAt: NOW,
    propertyLocalDate: '2026-06-01',
    attributionQuality: 'exact',
    retentionClass: 'provider-aligned',
    now: NOW,
    ...overrides,
  })
}

const recordedEvent = (reading: MetricReading = makeReading()) =>
  metricRecorded({
    readingId: reading.id,
    organizationId: reading.organizationId,
    propertyId: reading.propertyId,
    portalId: reading.portalId,
    portalGroupId: reading.portalGroupId,
    definitionVersionId: reading.definitionVersionId,
    sourceEventId: reading.sourceEventId,
    sourcePolicy: reading.sourcePolicy,
    metricKey: reading.metricKey,
    value: reading.value,
    numerator: reading.numerator,
    denominator: reading.denominator,
    sampleCount: reading.sampleCount,
    attributionQuality: reading.attributionQuality,
    permittedConsumers: ['dashboard'],
    occurredAt: reading.occurredAt,
  })

async function truncateAll(p: Pool) {
  await p.query('DELETE FROM metric_readings WHERE organization_id = $1', [ORG_ID])
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
    [ORG_ID, 'Metric Cmd Org', 'metriccmd-org'],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROP_ID, ORG_ID, 'Metric Cmd Property', 'metriccmd-prop', 'UTC'],
  )
})

afterAll(async () => {
  clearEventSchemas()
  await truncateAll(pool)
  await pool.query('DELETE FROM properties WHERE id = $1', [PROP_ID])
  await pool.query('DELETE FROM organization WHERE id = $1', [ORG_ID])
  await pool.end()
})

beforeEach(async () => {
  await truncateAll(pool)
})

describe.sequential('metricCommandStore (integration)', () => {
  it('recordMetric commits the reading + recorded fact in one transaction', async () => {
    const store = createAtomicMetricCommandStore(db, silentEvents)
    const reading = makeReading()
    const event = recordedEvent(reading)

    const inserted = await store.recordMetric({ reading, event })

    expect(inserted).toEqual({ status: 'recorded', reading })
    const rows = await pool.query(
      'SELECT id, metric_key, value FROM metric_readings WHERE id = $1',
      [READING_ID],
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]).toEqual({
      id: READING_ID as string,
      metric_key: 'property.review',
      value: 4,
    })
    const facts = await pool.query(
      `SELECT id, payload FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'metric.recorded' AND id = $2`,
      [ORG_ID, event.eventId],
    )
    expect(facts.rows).toHaveLength(1)
  })

  it('recordMetric rolls back the reading when the fact insert fails (unregistered type)', async () => {
    const store = createAtomicMetricCommandStore(db, silentEvents)
    const ghost = {
      ...recordedEvent(),
      _tag: 'metric.ghost',
    } as unknown as MetricRecorded

    await expect(
      store.recordMetric({ reading: makeReading(), event: ghost }),
    ).rejects.toThrow(/Event type metric\.ghost:v1 is not registered for the outbox/)

    const rows = await pool.query(
      'SELECT id FROM metric_readings WHERE organization_id = $1',
      [ORG_ID],
    )
    expect(rows.rows).toHaveLength(0)
  })
})
