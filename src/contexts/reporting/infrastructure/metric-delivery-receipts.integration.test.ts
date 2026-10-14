// A delivered fact that yields no reading still settles its delivery, against
// PostgreSQL.
//
// The dispatcher records no receipt for a handler that ran; a fact missing a
// catalogued consumer's receipt is redelivered three times and then counted as
// an exhausted delivery. A fact the registry cannot turn into a reading (a
// ratio under its minimum sample, a reading refused for its own content) used
// to return before the command store, so it never got the receipt and every
// content review of a small Portal left one stranded delivery behind.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createConsumerRegistry } from '#/shared/outbox/consumer-registry'
import {
  metricReadingId,
  organizationId,
  portalId,
  propertyId,
  scanEventId,
} from '#/shared/domain/ids'
import { recordMetric, recordMetrics } from '../application/use-cases/record-metric'
import { createAtomicMetricCommandStore } from './metric-command-store'
import { registerPortalWorkflowMetricConsumers } from './outbox-consumers'
import { onScanRecordedDurably } from './record-portal-metric'
import { createMetricRegistryRepository } from './repositories/metric-registry.repository'
import { createMetricRepository } from './repositories/metric.repository'
import { createPropertyLocalDateResolver } from './repositories/property-local-date'

const db = getDb()
const ORG = organizationId('org-metric-delivery-receipts')
const PROPERTY = propertyId('74000000-0000-4000-8000-000000000001')
const PORTAL = portalId('74000000-0000-4000-8000-000000000002')
const SMALL_PORTAL_EVENT = '74000000-0000-4000-8000-000000000011'
const FULL_PORTAL_EVENT = '74000000-0000-4000-8000-000000000012'
const UNATTRIBUTED_EVENT = '74000000-0000-4000-8000-000000000013'
const EARLY_SCAN_EVENT = '74000000-0000-4000-8000-000000000014'
const NOW = new Date('2026-10-02T12:00:00.000Z')
const WORKFLOW_CONSUMER = 'metric.portal-workflow'
const GUEST_CONSUMER = 'metric.guest-analytics'

type RatioFact = Readonly<{ eventId: string; configuredDestinations: number }>

function workflowDeps(attributed: boolean) {
  return {
    recordMetric: recordMetric({
      commandStore: createAtomicMetricCommandStore(db, randomUUID),
      registry: createMetricRegistryRepository(),
      clock: () => NOW,
      idGen: () => metricReadingId(randomUUID()),
      resolvePropertyLocalDate: createPropertyLocalDateResolver(db),
    }),
    resolveAttribution: async () =>
      attributed ? { propertyId: PROPERTY, portalGroupId: null } : null,
    hasReading: createMetricRepository(db, () => NOW).hasReading,
  }
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

function workflowPayload(extra: Readonly<Record<string, unknown>>) {
  return {
    reviewId: 'review-cycle-1',
    revision: 1,
    organizationId: ORG,
    propertyId: PROPERTY,
    portalId: PORTAL,
    portalGroupId: null,
    supersedesSourceEventId: null,
    occurredAt: NOW.toISOString(),
    ...extra,
  }
}

/** The ratio fact as the dispatcher hands it to the Portal workflow consumer. */
async function deliverRatio(fact: RatioFact, attributed = true): Promise<unknown> {
  const payload = workflowPayload({
    approvedDestinations: 1,
    configuredDestinations: fact.configuredDestinations,
  })
  await insertOutbox(
    fact.eventId,
    'portal.approved_destination_ratio.recorded',
    'portal',
    payload,
  )
  return handleWorkflow(
    'portal.approved_destination_ratio.recorded',
    fact.eventId,
    payload,
    attributed,
  )
}

async function handleWorkflow(
  eventType: string,
  eventId: string,
  payload: Readonly<Record<string, unknown>>,
  attributed: boolean,
): Promise<unknown> {
  const registry = createConsumerRegistry()
  registerPortalWorkflowMetricConsumers(registry, workflowDeps(attributed))
  const [consumer] = registry.listFor(eventType)
  if (!consumer) throw new Error(`${eventType} consumer was not registered`)
  return consumer.handler({
    eventId,
    eventType,
    eventVersion: 1,
    payload,
    organizationId: ORG,
    propertyId: PROPERTY,
    sourceContext: 'portal',
    sourceAggregateId: 'review-cycle-1',
    occurredAt: NOW.toISOString(),
    recordedAt: NOW.toISOString(),
  })
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
  it('settles the destination ratio of a Portal with too few links, with no reading', async () => {
    await expect(
      deliverRatio({ eventId: SMALL_PORTAL_EVENT, configuredDestinations: 2 }),
    ).resolves.toEqual({ status: 'applied' })

    await expect(receiptsOf(SMALL_PORTAL_EVENT)).resolves.toEqual([
      { consumer_name: WORKFLOW_CONSUMER, status: 'obsolete' },
    ])
    await expect(readingCount(SMALL_PORTAL_EVENT)).resolves.toBe(0)
  })

  it('settles it once when the same fact is delivered again', async () => {
    const fact = { eventId: SMALL_PORTAL_EVENT, configuredDestinations: 2 }
    await deliverRatio(fact)

    await expect(
      handleWorkflow(
        'portal.approved_destination_ratio.recorded',
        fact.eventId,
        workflowPayload({ approvedDestinations: 1, configuredDestinations: 2 }),
        true,
      ),
    ).resolves.toEqual({ status: 'applied' })

    await expect(receiptsOf(SMALL_PORTAL_EVENT)).resolves.toEqual([
      { consumer_name: WORKFLOW_CONSUMER, status: 'obsolete' },
    ])
  })

  it('still records the ratio of a Portal with enough links, with an applied receipt', async () => {
    await deliverRatio({ eventId: FULL_PORTAL_EVENT, configuredDestinations: 5 })

    await expect(receiptsOf(FULL_PORTAL_EVENT)).resolves.toEqual([
      { consumer_name: WORKFLOW_CONSUMER, status: 'applied' },
    ])
    await expect(readingCount(FULL_PORTAL_EVENT)).resolves.toBe(1)
  })

  it('settles a fact whose attribution cannot be resolved, with no reading', async () => {
    const payload = workflowPayload({})
    await insertOutbox(
      UNATTRIBUTED_EVENT,
      'portal.content_review.completed',
      'portal',
      payload,
    )

    await handleWorkflow(
      'portal.content_review.completed',
      UNATTRIBUTED_EVENT,
      payload,
      false,
    )

    await expect(receiptsOf(UNATTRIBUTED_EVENT)).resolves.toEqual([
      { consumer_name: WORKFLOW_CONSUMER, status: 'obsolete' },
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
