// BQC-3.5 — metric command store integration tests (real Postgres).
//
// Crash-boundary proofs on the real metric_readings table:
//   1. A forced outbox failure (unregistered fact type) rolls back EVERYTHING
//      — no reading row survives.
//   2. Happy path: the reading row and the outbox_events row commit together
//      with the same eventId, and the fact's readingId matches the row id
//      (the store inserts the use-case-assigned id explicitly).
//   3. Qualified Scan delivery commits its reading and consumer receipt exactly
//      once, while a missing source event commits neither.

import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import type { EventBus } from '#/shared/events/event-bus'
import {
  organizationId,
  portalId,
  propertyId,
  metricReadingId,
  portalAccessArtifactId,
  qualifiedScanId,
} from '#/shared/domain/ids'
import {
  createReading,
  type MetricReading,
  type ReadingResult,
} from '../../domain/metric-reading'
import { metricRecorded, type MetricRecorded } from '../../domain/events'
import { createAtomicMetricCommandStore } from '../metric-command-store'
import type { GuestQualifiedScanRecorded } from '#/contexts/guest/application/public-api'
import { recordMetric } from '../../application/use-cases/record-metric'
import { createMetricRegistryRepository } from './metric-registry.repository'
import { createPropertyLocalDateResolver } from './property-local-date'
import { onQualifiedScanRecordedDurably } from '../event-handlers/on-qualified-scan-recorded'
import { createMockLogger } from '#/shared/testing/mock-logger'

const ORG_ID = organizationId('org-metriccmd-0000-0000-0000-000000000001')
const PROP_ID = propertyId('4d000000-0000-0000-0000-000000000001')
const READING_ID = metricReadingId('4e000000-0000-0000-0000-000000000001')
const PORTAL_ID = portalId('4f000000-0000-4000-8000-000000000001')
const NOW = new Date('2026-06-01T12:00:00.000Z')
const STAFF_EFFECTIVE_FROM = new Date('2026-05-01T00:00:00.000Z')
const STAFF_PARTICIPANT = '4f000000-0000-4000-8000-000000000011'
const STAFF_PARTICIPATION = '4f000000-0000-4000-8000-000000000012'
const PORTAL_RESPONSIBILITY = '4f000000-0000-4000-8000-000000000013'
const STAFF_ATTRIBUTION = {
  staffParticipantId: STAFF_PARTICIPANT,
  staffParticipationId: STAFF_PARTICIPATION,
  portalResponsibilityId: PORTAL_RESPONSIBILITY,
  effectiveFrom: STAFF_EFFECTIVE_FROM,
  effectiveTo: null,
} as const
const QUALIFIED_EVENT_ID = '4f000000-0000-4000-8000-000000000021'
const MISSING_SOURCE_EVENT_ID = '4f000000-0000-4000-8000-000000000022'
const QUALIFIED_SCAN_ID = qualifiedScanId('4f000000-0000-4000-8000-000000000023')
const ACCESS_ARTIFACT_ID = portalAccessArtifactId('4f000000-0000-4000-8000-000000000024')
const QUALIFIED_AT = new Date('2026-09-01T12:00:00.000Z')

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
    staffAttribution: reading.staffAttribution,
  })

async function truncateAll(p: Pool) {
  await p.query(
    `DELETE FROM metric_corrections
     WHERE reading_id IN (
       SELECT id FROM metric_readings WHERE organization_id = $1
     )`,
    [ORG_ID],
  )
  await p.query(
    'DELETE FROM portal_metric_lifetime_aggregates WHERE organization_id = $1',
    [ORG_ID],
  )
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
  await truncateAll(pool)
  await pool.query('DELETE FROM portal_responsibilities WHERE organization_id = $1', [
    ORG_ID,
  ])
  await pool.query('DELETE FROM staff_participations WHERE organization_id = $1', [
    ORG_ID,
  ])
  await pool.query('DELETE FROM staff_participants WHERE organization_id = $1', [ORG_ID])
  await pool.query('DELETE FROM portals WHERE id = $1', [PORTAL_ID])
  await pool.query('DELETE FROM properties WHERE id = $1', [PROP_ID])
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       slug = EXCLUDED.slug`,
    [ORG_ID, 'Metric Cmd Org', 'metriccmd-org'],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       organization_id = EXCLUDED.organization_id,
       name = EXCLUDED.name,
       slug = EXCLUDED.slug,
       timezone = EXCLUDED.timezone,
       updated_at = EXCLUDED.updated_at`,
    [PROP_ID, ORG_ID, 'Metric Cmd Property', 'metriccmd-prop', 'UTC'],
  )
  await pool.query(
    `INSERT INTO portals (
       id, organization_id, property_id, entity_type, entity_id, name, slug,
       publication_state, created_at, updated_at
     ) VALUES ($1, $2, $3, 'property', $4, $5, $6, 'published', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [
      PORTAL_ID,
      ORG_ID,
      PROP_ID,
      String(PROP_ID),
      'Metric Cmd Portal',
      'metriccmd-portal',
    ],
  )
  await pool.query(
    `INSERT INTO staff_participants
       (id, organization_id, display_name, status, revision, created_by,
        created_at, updated_at)
     VALUES ($1, $2, 'Metric Primary', 'active', 1, 'test', $3, $3)`,
    [STAFF_PARTICIPANT, ORG_ID, STAFF_EFFECTIVE_FROM],
  )
  await pool.query(
    `INSERT INTO staff_participations
       (id, organization_id, property_id, staff_participant_id, display_name,
        status, started_at, revision, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'Metric Primary', 'active', $5, 1, 'test', $5, $5)`,
    [STAFF_PARTICIPATION, ORG_ID, PROP_ID, STAFF_PARTICIPANT, STAFF_EFFECTIVE_FROM],
  )
  await pool.query(
    `INSERT INTO portal_responsibilities
       (id, organization_id, property_id, portal_id, staff_participation_id,
        kind, effective_from, created_by)
     VALUES ($1, $2, $3, $4, $5, 'primary', $6, 'test')`,
    [
      PORTAL_RESPONSIBILITY,
      ORG_ID,
      PROP_ID,
      PORTAL_ID,
      STAFF_PARTICIPATION,
      STAFF_EFFECTIVE_FROM,
    ],
  )
})

afterAll(async () => {
  clearEventSchemas()
  await truncateAll(pool)
  await pool.query('DELETE FROM portal_responsibilities WHERE organization_id = $1', [
    ORG_ID,
  ])
  await pool.query('DELETE FROM staff_participations WHERE organization_id = $1', [
    ORG_ID,
  ])
  await pool.query('DELETE FROM staff_participants WHERE organization_id = $1', [ORG_ID])
  await pool.query('DELETE FROM portals WHERE id = $1', [PORTAL_ID])
  await pool.query('DELETE FROM properties WHERE id = $1', [PROP_ID])
  await deleteTestOrganizations(pool, [ORG_ID])
  await pool.end()
})

beforeEach(async () => {
  await truncateAll(pool)
})

describe.sequential('metricCommandStore (integration)', () => {
  it('recordMetric commits the reading + recorded fact in one transaction', async () => {
    const store = createAtomicMetricCommandStore(db, silentEvents, randomUUID)
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

  it('commits the qualified-scan reading and consumer receipt once or neither', async () => {
    const sourceEvent: GuestQualifiedScanRecorded = {
      _tag: 'guest.qualified_scan.recorded',
      eventId: QUALIFIED_EVENT_ID,
      correlationId: null,
      qualifiedScanId: QUALIFIED_SCAN_ID,
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      portalId: PORTAL_ID,
      portalGroupId: null,
      accessArtifactId: ACCESS_ARTIFACT_ID,
      staffAttribution: null,
      occurredAt: QUALIFIED_AT,
    }
    await pool.query(
      `INSERT INTO outbox_events (
         id, event_type, event_version, payload, organization_id, property_id,
         source_context, source_aggregate_id
       ) VALUES ($1, $2, 1, $3::jsonb, $4, $5, 'guest', $6)`,
      [
        sourceEvent.eventId,
        sourceEvent._tag,
        JSON.stringify({
          organizationId: sourceEvent.organizationId,
          propertyId: sourceEvent.propertyId,
          portalId: sourceEvent.portalId,
          qualifiedScanId: sourceEvent.qualifiedScanId,
          portalGroupId: sourceEvent.portalGroupId,
          accessArtifactId: sourceEvent.accessArtifactId,
          staffAttribution: sourceEvent.staffAttribution,
          occurredAt: sourceEvent.occurredAt.toISOString(),
        }),
        ORG_ID,
        PROP_ID,
        QUALIFIED_SCAN_ID,
      ],
    )

    const outcomes: ReadingResult[] = []
    const project = recordMetric({
      commandStore: createAtomicMetricCommandStore(db, silentEvents, randomUUID),
      registry: createMetricRegistryRepository(db),
      clock: () => QUALIFIED_AT,
      idGen: () => metricReadingId(randomUUID()),
      resolvePropertyLocalDate: createPropertyLocalDateResolver(db),
    })
    const handler = onQualifiedScanRecordedDurably({
      recordMetric: async (input) => {
        const outcome = await project(input)
        outcomes.push(outcome)
        return outcome
      },
      findGroupForPortal: async () => null,
      logger: createMockLogger(),
    })

    await handler(sourceEvent)
    await handler(sourceEvent)

    const first = outcomes[0]
    expect(first?.status).toBe('recorded')
    if (!first || first.status !== 'recorded') {
      throw new Error('qualified scan was not recorded')
    }
    expect(outcomes[1]).toEqual({
      status: 'duplicate',
      existingReadingId: first.reading.id,
    })

    const readings = await pool.query(
      `SELECT id, metric_key
       FROM metric_readings
       WHERE source_event_id = $1`,
      [sourceEvent.eventId],
    )
    expect(readings.rows).toEqual([
      { id: first.reading.id as string, metric_key: 'portal.qualified_scan' },
    ])
    const receipts = await pool.query(
      `SELECT event_id, consumer_name, status
       FROM event_consumer_receipts
       WHERE event_id = $1 AND consumer_name = 'metric.guest-analytics'`,
      [sourceEvent.eventId],
    )
    expect(receipts.rows).toEqual([
      {
        event_id: sourceEvent.eventId,
        consumer_name: 'metric.guest-analytics',
        status: 'applied',
      },
    ])

    const missingSourceEvent: GuestQualifiedScanRecorded = {
      ...sourceEvent,
      eventId: MISSING_SOURCE_EVENT_ID,
      qualifiedScanId: qualifiedScanId('4f000000-0000-4000-8000-000000000025'),
    }
    await expect(handler(missingSourceEvent)).rejects.toThrow(/Failed query/u)
    const partial = await pool.query(
      `SELECT
         (
           SELECT count(*)::int FROM metric_readings WHERE source_event_id = $1
         ) AS reading_count,
         (
           SELECT count(*)::int FROM event_consumer_receipts
           WHERE event_id = $1::uuid AND consumer_name = 'metric.guest-analytics'
         ) AS receipt_count`,
      [missingSourceEvent.eventId],
    )
    expect(partial.rows).toEqual([{ reading_count: 0, receipt_count: 0 }])
  })

  it('recordMetric rolls back the reading when the fact insert fails (unregistered type)', async () => {
    const store = createAtomicMetricCommandStore(db, silentEvents, randomUUID)
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

  it('retracts a specific Guest source fact without replacing it with zero', async () => {
    const store = createAtomicMetricCommandStore(db, silentEvents, randomUUID)
    const reading = makeReading({
      definitionVersionId: '11111111-1111-4111-8111-111111111303',
      metricKey: 'portal.rating_average',
      portalId: PORTAL_ID,
      value: 4,
      sourceEventId: 'guest-rating-source-1',
      sourcePolicy: 'first_party_guest_gateway_metric',
      retentionClass: 'guest_gateway_24_month',
      staffAttribution: STAFF_ATTRIBUTION,
    })
    await store.recordMetric({ reading, event: recordedEvent(reading) })

    const command = {
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      portalId: PORTAL_ID,
      definitionVersionId: reading.definitionVersionId,
      sourceEventId: 'guest-rating-retracted-1',
      supersedesSourceEventId: reading.sourceEventId,
      occurredAt: new Date('2026-06-01T12:30:00.000Z'),
      staffAttribution: reading.staffAttribution,
    }
    await expect(store.retractMetric(command)).resolves.toEqual({
      status: 'retracted',
      correctedReadingId: READING_ID,
    })
    await expect(store.retractMetric(command)).resolves.toEqual({
      status: 'duplicate',
      correctedReadingId: READING_ID,
    })

    const corrections = await pool.query(
      `SELECT kind, replacement_value, attributed_staff_participant_id,
              attributed_staff_participation_id, attribution_responsibility_id,
              staff_attribution_effective_from, staff_attribution_effective_to
       FROM metric_corrections WHERE reading_id = $1`,
      [READING_ID],
    )
    expect(corrections.rows).toEqual([
      {
        kind: 'retract',
        replacement_value: null,
        attributed_staff_participant_id: STAFF_PARTICIPANT,
        attributed_staff_participation_id: STAFF_PARTICIPATION,
        attribution_responsibility_id: PORTAL_RESPONSIBILITY,
        staff_attribution_effective_from: STAFF_EFFECTIVE_FROM,
        staff_attribution_effective_to: null,
      },
    ])
    const replacementRows = await pool.query(
      `SELECT id FROM metric_readings
       WHERE organization_id = $1 AND source_event_id = $2`,
      [ORG_ID, 'guest-rating-retracted-1'],
    )
    expect(replacementRows.rows).toHaveLength(0)
    const facts = await pool.query(
      `SELECT payload FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'metric.corrected'`,
      [ORG_ID],
    )
    expect(facts.rows).toHaveLength(1)
    expect(facts.rows[0].payload).toMatchObject({
      replacementReadingId: null,
      staffAttribution: {
        staffParticipantId: STAFF_PARTICIPANT,
        staffParticipationId: STAFF_PARTICIPATION,
        portalResponsibilityId: PORTAL_RESPONSIBILITY,
        effectiveFrom: STAFF_EFFECTIVE_FROM.toISOString(),
        effectiveTo: null,
      },
    })
  })
})
