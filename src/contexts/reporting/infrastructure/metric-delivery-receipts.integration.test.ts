// A delivered fact that yields no reading still settles its delivery in the
// same PostgreSQL command. Replay must not duplicate the receipt or reading.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  metricReadingId,
  organizationId,
  portalId,
  propertyId,
  scanEventId,
} from '#/shared/domain/ids'
import { recordMetric, recordMetrics } from '../application/use-cases/record-metric'
import type { GovernedMetricVersion } from '../readings/contracts'
import { createAtomicMetricCommandStore } from '../readings/metric-command-store.server'
import { onScanRecordedDurably } from '../readings/record-portal-metric.server'
import { createMetricRegistryRepository } from './repositories/metric-registry.repository'
import { createPropertyLocalDateResolver } from './repositories/property-local-date'

const db = getDb()
const ORG = organizationId('org-metric-delivery-receipts')
const PROPERTY = propertyId('74000000-0000-4000-8000-000000000001')
const PORTAL = portalId('74000000-0000-4000-8000-000000000002')
const SMALL_SAMPLE_EVENT = '74000000-0000-4000-8000-000000000011'
const FULL_SAMPLE_EVENT = '74000000-0000-4000-8000-000000000012'
const UNATTRIBUTED_EVENT = '74000000-0000-4000-8000-000000000013'
const EARLY_SCAN_EVENT = '74000000-0000-4000-8000-000000000014'
const NOW = new Date('2026-10-02T12:00:00.000Z')
const GUEST_CONSUMER = 'metric.guest-analytics'
const RATIO_CONSUMER = 'metric.portal-workflow'

// Exercise the shared ratio/receipt decision without re-admitting retired
// versions to the production catalogue.
const RATIO: GovernedMetricVersion = {
  definition: {
    id: '11111111-1111-4111-8111-111111110103',
    key: 'portal.approved_destination_ratio',
    valueKind: 'ratio',
    workerDataFlag: false,
    privacyClass: 'operational',
    retentionClass: 'standard',
    lifecycleStatus: 'approved',
  },
  version: {
    id: '11111111-1111-4111-8111-111111111103',
    definitionId: '11111111-1111-4111-8111-111111110103',
    version: 1,
    effectiveFrom: new Date('2026-08-08T00:00:00.000Z'),
    effectiveTo: null,
    unit: 'ratio',
    precision: 4,
    allowedScopes: ['property'],
    minimumSample: 5,
    insufficientDataBehavior: 'unavailable',
    sourcePolicyAllowlist: ['first_party_workflow'],
    permittedConsumers: ['dashboard'],
    employmentDecisionEligible: false,
  },
}

async function insertOutbox(
  eventId: string,
  eventType: string,
  sourceContext: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO outbox_events (
      id, event_type, event_version, payload, organization_id, property_id,
      source_context, source_aggregate_id
    ) VALUES (
      ${eventId}::uuid, ${eventType}, 1, ${JSON.stringify(payload)}::jsonb,
      ${ORG}, ${PROPERTY}, ${sourceContext}, ${PORTAL}
    )
  `)
}

function recordRatio(eventId: string, sampleCount: number, attributed = true) {
  return recordMetric({
    commandStore: createAtomicMetricCommandStore(db, randomUUID),
    registry: { findVersionById: async () => RATIO },
    clock: () => NOW,
    idGen: () => metricReadingId(randomUUID()),
    resolvePropertyLocalDate: createPropertyLocalDateResolver(db),
  })({
    organizationId: ORG,
    propertyId: PROPERTY,
    portalId: PORTAL,
    portalGroupId: null,
    definitionVersionId: RATIO.version.id,
    sourceEventId: eventId,
    sourcePolicy: 'first_party_workflow',
    scope: 'property',
    occurredAt: NOW,
    attributionQuality: attributed ? 'exact' : 'unresolved',
    value: Number((1 / sampleCount).toFixed(4)),
    numerator: 1,
    denominator: sampleCount,
    sampleCount,
    sourceReceipt: { eventId, consumerName: RATIO_CONSUMER },
  })
}

async function deliverRatio(eventId: string, sampleCount: number, attributed = true) {
  await insertOutbox(eventId, 'portal.approved_destination_ratio.recorded', 'portal', {
    organizationId: ORG,
    propertyId: PROPERTY,
    portalId: PORTAL,
    occurredAt: NOW.toISOString(),
    reviewId: 'review-cycle-1',
    revision: 1,
    portalGroupId: null,
    supersedesSourceEventId: null,
    approvedDestinations: 1,
    configuredDestinations: sampleCount,
  })
  return recordRatio(eventId, sampleCount, attributed)
}

async function receiptsOf(
  eventId: string,
): Promise<readonly { consumer_name: string; status: string }[]> {
  const { rows } = await db.execute<{ consumer_name: string; status: string }>(sql`
    SELECT consumer_name, status FROM event_consumer_receipts
    WHERE event_id = ${eventId}::uuid ORDER BY consumer_name
  `)
  return rows
}

async function readingCount(sourceEventId: string): Promise<number> {
  const { rows } = await db.execute<{ readings: number }>(sql`
    SELECT count(*)::int AS readings FROM metric_readings
    WHERE organization_id = ${ORG} AND source_event_id = ${sourceEventId}
  `)
  return rows[0]?.readings ?? 0
}

async function clean(): Promise<void> {
  await db.execute(sql`
    DELETE FROM metric_corrections
    WHERE reading_id IN (SELECT id FROM metric_readings WHERE organization_id = ${ORG})
  `)
  await db.execute(sql`DELETE FROM metric_readings WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`)
}

beforeAll(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'Metric Delivery Receipts', ${ORG}, now())
    ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone)
    VALUES (${PROPERTY}, ${ORG}, 'Delivery Receipts Property', 'delivery-receipts-property', 'UTC')
    ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO portals (
      id, organization_id, property_id, entity_type, entity_id, name, slug,
      publication_state
    ) VALUES (
      ${PORTAL}, ${ORG}, ${PROPERTY}, 'property', ${PROPERTY},
      'Delivery Receipts Portal', 'delivery-receipts-portal', 'published'
    ) ON CONFLICT (id) DO NOTHING
  `)
})

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await clean()
})

afterAll(async () => {
  await clean()
  await db.execute(sql`DELETE FROM portals WHERE id = ${PORTAL}`)
  await db.execute(sql`DELETE FROM properties WHERE id = ${PROPERTY}`)
  await deleteTestOrganizations(db, [ORG])
  clearEventSchemas()
})

describe.sequential('Metric delivery receipts (integration)', () => {
  it('settles a ratio below the sample floor, with no reading', async () => {
    await expect(deliverRatio(SMALL_SAMPLE_EVENT, 2)).resolves.toMatchObject({
      status: 'insufficient_data',
      minimumSample: 5,
      actualSample: 2,
    })

    await expect(receiptsOf(SMALL_SAMPLE_EVENT)).resolves.toEqual([
      { consumer_name: RATIO_CONSUMER, status: 'obsolete' },
    ])
    await expect(readingCount(SMALL_SAMPLE_EVENT)).resolves.toBe(0)
  })

  it('settles it once when the same fact is delivered again', async () => {
    await deliverRatio(SMALL_SAMPLE_EVENT, 2)

    await expect(recordRatio(SMALL_SAMPLE_EVENT, 2)).resolves.toMatchObject({
      status: 'insufficient_data',
    })

    await expect(receiptsOf(SMALL_SAMPLE_EVENT)).resolves.toEqual([
      { consumer_name: RATIO_CONSUMER, status: 'obsolete' },
    ])
    await expect(readingCount(SMALL_SAMPLE_EVENT)).resolves.toBe(0)
  })

  it('records a ratio at the sample floor, with an applied receipt', async () => {
    await expect(deliverRatio(FULL_SAMPLE_EVENT, 5)).resolves.toMatchObject({
      status: 'recorded',
    })

    await expect(receiptsOf(FULL_SAMPLE_EVENT)).resolves.toEqual([
      { consumer_name: RATIO_CONSUMER, status: 'applied' },
    ])
    await expect(readingCount(FULL_SAMPLE_EVENT)).resolves.toBe(1)
  })

  it('settles a fact whose attribution cannot be resolved, with no reading', async () => {
    await expect(deliverRatio(UNATTRIBUTED_EVENT, 5, false)).resolves.toMatchObject({
      status: 'rejected',
      reason: 'unresolved_attribution',
    })

    await expect(receiptsOf(UNATTRIBUTED_EVENT)).resolves.toEqual([
      { consumer_name: RATIO_CONSUMER, status: 'obsolete' },
    ])
    await expect(readingCount(UNATTRIBUTED_EVENT)).resolves.toBe(0)
  })

  it('settles a Guest scan from before its measure took effect, with no reading', async () => {
    await insertOutbox(EARLY_SCAN_EVENT, 'guest.scan.recorded', 'guest', {
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      occurredAt: '2026-07-01T10:00:00.000Z',
    })

    await onScanRecordedDurably({
      recordMetrics: recordMetrics({
        commandStore: createAtomicMetricCommandStore(db, randomUUID),
        registry: createMetricRegistryRepository(),
        clock: () => NOW,
        idGen: () => metricReadingId(randomUUID()),
        resolvePropertyLocalDate: createPropertyLocalDateResolver(db),
      }),
      findGroupForPortal: async () => null,
    })({
      _tag: 'guest.scan.recorded',
      eventId: EARLY_SCAN_EVENT,
      correlationId: null,
      scanId: scanEventId(randomUUID()),
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      scanSource: 'qr',
      occurredAt: new Date('2026-07-01T10:00:00.000Z'),
    })

    await expect(receiptsOf(EARLY_SCAN_EVENT)).resolves.toEqual([
      { consumer_name: GUEST_CONSUMER, status: 'obsolete' },
    ])
    await expect(readingCount(EARLY_SCAN_EVENT)).resolves.toBe(0)
  })
})
