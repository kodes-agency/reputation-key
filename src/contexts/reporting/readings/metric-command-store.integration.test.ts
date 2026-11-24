import { metricRegistry } from './contracts'
import { createPortalAnalyticsRepository } from '../portal-results/portal-analytics.repository.server'
import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { seedTenantPortal } from '#/shared/db/testing/tenant-seed'
import {
  organizationId,
  portalId,
  portalLinkId,
  propertyId,
  metricReadingId,
  portalAccessArtifactId,
  qualifiedScanId,
} from '#/shared/domain/ids'
import {
  createReading,
  type MetricReading,
  type ReadingResult,
} from '../domain/metric-reading'
import { recordOne, retractOne } from './single-reading.test-fixtures'
import { createAtomicMetricCommandStore } from './metric-command-store.server'
import type {
  GuestReviewLinkClicked,
  GuestQualifiedScanRecorded,
} from '#/contexts/guest/public-api'
import { recordMetrics } from './record-metric.server'
import { createPropertyLocalDateResolver } from './property-local-date.server'
import {
  onQualifiedScanRecordedDurably,
  onReviewLinkClickedDurably,
} from './record-portal-metric.server'

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
// A second tenant, so the organization predicates are exercised.
const OTHER_ORG_ID = organizationId('org-metriccmd-0000-0000-0000-000000000002')
const OTHER_PROP_ID = propertyId('4d000000-0000-0000-0000-000000000002')
const OTHER_PORTAL_ID = portalId('4f000000-0000-4000-8000-000000000002')
const OTHER_READING_ID = metricReadingId('4e000000-0000-0000-0000-000000000002')
const TENANT_IDS: readonly string[] = [ORG_ID, OTHER_ORG_ID]

let pool: Pool
const db = getDb()

function makeReading(overrides: Partial<MetricReading> = {}): MetricReading {
  return createReading({
    id: READING_ID,
    definitionVersionId: '11111111-1111-4111-8111-111111111202',
    metricKey: 'portal.rating',
    organizationId: ORG_ID,
    propertyId: PROP_ID,
    portalId: PORTAL_ID,
    portalGroupId: null,
    value: 4,
    sampleCount: 1,
    sourceEventId: 'integration-source-event-1',
    sourcePolicy: 'first_party_guest_private',
    occurredAt: NOW,
    propertyLocalDate: '2026-06-01',
    attributionQuality: 'exact',
    retentionClass: 'short',
    now: NOW,
    ...overrides,
  })
}

async function truncateAll(p: Pool) {
  await p.query(
    `DELETE FROM metric_corrections
     WHERE reading_id IN (
       SELECT id FROM metric_readings WHERE organization_id = ANY($1)
     )`,
    [TENANT_IDS],
  )
  await p.query('DELETE FROM metric_readings WHERE organization_id = ANY($1)', [
    TENANT_IDS,
  ])
  await p.query('DELETE FROM outbox_events WHERE organization_id = ANY($1)', [TENANT_IDS])
}

async function clearTenantRows(p: Pool) {
  await truncateAll(p)
  await p.query('DELETE FROM portal_responsibilities WHERE organization_id = $1', [
    ORG_ID,
  ])
  await p.query('DELETE FROM staff_participations WHERE organization_id = $1', [ORG_ID])
  await p.query('DELETE FROM staff_participants WHERE organization_id = $1', [ORG_ID])
  await p.query('DELETE FROM portals WHERE id = ANY($1)', [[PORTAL_ID, OTHER_PORTAL_ID]])
  await p.query('DELETE FROM properties WHERE id = ANY($1)', [[PROP_ID, OTHER_PROP_ID]])
}

async function seedGuestSourceEvent(
  p: Pool,
  event: Readonly<{ id: string; type: string; payload: unknown; aggregateId: string }>,
) {
  await p.query(
    `INSERT INTO outbox_events (
       id, event_type, event_version, payload, organization_id, property_id,
       source_context, source_aggregate_id
     ) VALUES ($1, $2, 1, $3::jsonb, $4, $5, 'guest', $6)`,
    [
      event.id,
      event.type,
      JSON.stringify(event.payload),
      ORG_ID,
      PROP_ID,
      event.aggregateId,
    ],
  )
}

const projectMetrics = () =>
  recordMetrics({
    commandStore: createAtomicMetricCommandStore(db, randomUUID),
    registry: metricRegistry,
    clock: () => QUALIFIED_AT,
    idGen: () => metricReadingId(randomUUID()),
    resolvePropertyLocalDate: createPropertyLocalDateResolver(db),
  })

async function receiptsOf(eventId: string) {
  const receipts = await pool.query(
    `SELECT event_id, consumer_name, status
     FROM event_consumer_receipts
     WHERE event_id = $1 AND consumer_name = 'metric.guest-analytics'`,
    [eventId],
  )
  return receipts.rows
}

async function readingAndReceiptCounts(sourceEventId: string) {
  const counts = await pool.query(
    `SELECT
       (
         SELECT count(*)::int FROM metric_readings WHERE source_event_id = $1
       ) AS reading_count,
       (
         SELECT count(*)::int FROM event_consumer_receipts
         WHERE event_id = $1::uuid AND consumer_name = 'metric.guest-analytics'
       ) AS receipt_count`,
    [sourceEventId],
  )
  return counts.rows
}

async function correctionAndReceiptCounts(eventId: string) {
  const counts = await pool.query(
    `SELECT
       (
         SELECT count(*)::int FROM metric_corrections
         WHERE source_event_id LIKE $1
       ) AS correction_count,
       (
         SELECT count(*)::int FROM event_consumer_receipts
         WHERE event_id = $2::uuid AND consumer_name = 'metric.guest-analytics'
       ) AS receipt_count`,
    [`${eventId}:%`, eventId],
  )
  return counts.rows
}

const RATING_FANOUT_DEFINITIONS = [
  {
    id: '11111111-1111-4111-8111-111111111202',
    key: 'portal.rating' as const,
    value: 4,
    sourcePolicy: 'first_party_guest_private' as const,
  },
  {
    id: '11111111-1111-4111-8111-111111111302',
    key: 'portal.rating_count' as const,
    value: 1,
    sourcePolicy: 'first_party_guest_gateway_metric' as const,
  },
  {
    id: '11111111-1111-4111-8111-111111111303',
    key: 'portal.rating_average' as const,
    value: 4,
    sourcePolicy: 'first_party_guest_gateway_metric' as const,
  },
]

const ratingFanoutEntries = (eventId: string) =>
  RATING_FANOUT_DEFINITIONS.map((definition) => ({
    reading: makeReading({
      id: metricReadingId(randomUUID()),
      definitionVersionId: definition.id,
      metricKey: definition.key,
      portalId: PORTAL_ID,
      portalGroupId: null,
      value: definition.value,
      sourceEventId: eventId,
      sourcePolicy: definition.sourcePolicy,
      retentionClass: 'guest_gateway_24_month',
    }),
    destinationKind: null,
  }))

beforeAll(async () => {
  const env = getEnv()
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 })
  const client = await pool.connect()
  client.release()
  await clearTenantRows(pool)
  await seedTenantPortal(pool, {
    orgId: ORG_ID,
    propId: PROP_ID,
    portalId: PORTAL_ID,
    label: 'Metric Cmd',
    slug: 'metriccmd',
  })
  await seedTenantPortal(pool, {
    orgId: OTHER_ORG_ID,
    propId: OTHER_PROP_ID,
    portalId: OTHER_PORTAL_ID,
    label: 'Metric Cmd Other',
    slug: 'metriccmd-other',
  })
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
  await clearTenantRows(pool)
  await deleteTestOrganizations(pool, TENANT_IDS)
  await pool.end()
})

beforeEach(async () => {
  await truncateAll(pool)
})

describe.sequential('metricCommandStore (integration)', () => {
  it('recordMetric commits the reading without an unconsumed outbox fact', async () => {
    const store = createAtomicMetricCommandStore(db, randomUUID)
    const reading = makeReading()

    const inserted = await recordOne(store, { reading })

    expect(inserted).toEqual({ status: 'recorded', reading })
    const rows = await pool.query(
      'SELECT id, metric_key, value FROM metric_readings WHERE id = $1',
      [READING_ID],
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]).toEqual({
      id: READING_ID as string,
      metric_key: 'portal.rating',
      value: 4,
    })
    const facts = await pool.query(
      `SELECT id, payload FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'metric.recorded'`,
      [ORG_ID],
    )
    expect(facts.rows).toHaveLength(0)
  })

  it.each([
    [
      'secondary_link',
      '10000000-0000-4000-8000-000000000006',
      '10000000-0000-4000-8000-000000000006',
    ],
    ['google_review', `google-review:${PORTAL_ID}`, null],
    ['secondary_link', 'legacy-non-uuid-link', null],
  ] as const)(
    'keeps %s link attribution for %s and applies the event once',
    async (destinationKind, linkId, expectedLinkId) => {
      const sourceEvent: GuestReviewLinkClicked = {
        _tag: 'guest.review_link.clicked',
        eventId: randomUUID(),
        correlationId: null,
        organizationId: ORG_ID,
        propertyId: PROP_ID,
        portalId: PORTAL_ID,
        linkId: portalLinkId(linkId),
        destinationKind,
        occurredAt: QUALIFIED_AT,
      }
      await seedGuestSourceEvent(pool, {
        id: sourceEvent.eventId,
        type: sourceEvent._tag,
        payload: sourceEvent,
        aggregateId: PORTAL_ID,
      })
      const project = projectMetrics()
      const handler = onReviewLinkClickedDurably({
        recordMetrics: project,
        findGroupForPortal: async () => null,
      })
      await handler(sourceEvent)
      await handler(sourceEvent)
      const readings = await pool.query(
        `SELECT portal_link_id, portal_destination_kind FROM metric_readings WHERE source_event_id = $1`,
        [sourceEvent.eventId],
      )
      expect(readings.rows).toEqual([
        { portal_link_id: expectedLinkId, portal_destination_kind: destinationKind },
      ])
      expect(await receiptsOf(sourceEvent.eventId)).toEqual([
        {
          event_id: sourceEvent.eventId,
          consumer_name: 'metric.guest-analytics',
          status: 'applied',
        },
      ])
      const destinationCounts = await createPortalAnalyticsRepository(
        db,
        () => QUALIFIED_AT,
      ).getPortalKpiSums(
        ORG_ID,
        PROP_ID,
        PORTAL_ID,
        new Date(0),
        new Date('2027-01-01T00:00:00.000Z'),
      )
      expect(
        destinationCounts.find((row) => row.metricKey === 'portal.review_link_click')
          ?.total ?? 0,
      ).toBe(destinationKind === 'google_review' ? 1 : 0)
      if (expectedLinkId) {
        await expect(
          pool.query(
            `UPDATE metric_readings SET portal_destination_kind = 'google_review' WHERE source_event_id = $1`,
            [sourceEvent.eventId],
          ),
        ).rejects.toMatchObject({ constraint: 'metric_readings_portal_link_check' })
      }
    },
  )

  it('keeps a link on an append-only replacement and leaves legacy readings null on replay', async () => {
    const store = createAtomicMetricCommandStore(db, randomUUID)
    const linkId = '10000000-0000-4000-8000-000000000006'
    const original = makeReading({
      portalId: PORTAL_ID,
      portalLinkId: linkId,
      metricKey: 'portal.review_link_click',
      sourcePolicy: 'review_solicitation_analytics_only',
      value: 1,
      definitionVersionId: '11111111-1111-4111-8111-111111111204',
    })
    await recordOne(store, {
      reading: original,
      destinationKind: 'secondary_link',
    })
    const otherLinkReading = { ...original, portalLinkId: randomUUID() }
    await expect(
      recordOne(store, {
        reading: otherLinkReading,
        destinationKind: 'secondary_link',
      }),
    ).rejects.toThrow('Duplicate metric reading Portal link does not match')
    const wrongReplacement = {
      ...otherLinkReading,
      id: metricReadingId(randomUUID()),
      sourceEventId: 'wrong-link-replacement',
    }
    await expect(
      recordOne(store, {
        reading: wrongReplacement,
        destinationKind: 'secondary_link',
        supersedesSourceEventId: original.sourceEventId,
      }),
    ).rejects.toThrow('Replacement metric Portal link does not match its source reading')
    const replacement = {
      ...original,
      id: metricReadingId(randomUUID()),
      sourceEventId: 'replacement-link-tap',
    }
    await recordOne(store, {
      reading: replacement,
      destinationKind: 'secondary_link',
      supersedesSourceEventId: original.sourceEventId,
    })
    const rows = await pool.query(
      `SELECT portal_link_id FROM metric_readings WHERE organization_id = $1 ORDER BY source_event_id`,
      [ORG_ID],
    )
    expect(rows.rows).toEqual([{ portal_link_id: linkId }, { portal_link_id: linkId }])
    // A pre-deploy reading stays unattributed even when the source is delivered again.
    await pool.query(`UPDATE metric_readings SET portal_link_id = NULL WHERE id = $1`, [
      original.id,
    ])
    expect(
      (
        await recordOne(store, {
          reading: original,
          destinationKind: 'secondary_link',
        })
      ).status,
    ).toBe('duplicate')
    const legacy = await pool.query(
      `SELECT portal_link_id FROM metric_readings WHERE id = $1`,
      [original.id],
    )
    expect(legacy.rows).toEqual([{ portal_link_id: null }])
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
    await seedGuestSourceEvent(pool, {
      id: sourceEvent.eventId,
      type: sourceEvent._tag,
      payload: {
        organizationId: sourceEvent.organizationId,
        propertyId: sourceEvent.propertyId,
        portalId: sourceEvent.portalId,
        qualifiedScanId: sourceEvent.qualifiedScanId,
        portalGroupId: sourceEvent.portalGroupId,
        accessArtifactId: sourceEvent.accessArtifactId,
        staffAttribution: sourceEvent.staffAttribution,
        occurredAt: sourceEvent.occurredAt.toISOString(),
      },
      aggregateId: QUALIFIED_SCAN_ID,
    })

    const outcomes: ReadingResult[] = []
    const project = projectMetrics()
    const handler = onQualifiedScanRecordedDurably({
      recordMetrics: async (input) => {
        const outcome = await project(input)
        outcomes.push(...outcome)
        return outcome
      },
      findGroupForPortal: async () => null,
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
    expect(await receiptsOf(sourceEvent.eventId)).toEqual([
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
    expect(await readingAndReceiptCounts(missingSourceEvent.eventId)).toEqual([
      { reading_count: 0, receipt_count: 0 },
    ])
  })

  it('commits a rating fanout with one receipt and heals a legacy partial batch', async () => {
    const sourceEventId = '4f000000-0000-4000-8000-000000000031'
    const missingSourceEventId = '4f000000-0000-4000-8000-000000000032'
    await seedGuestSourceEvent(pool, {
      id: sourceEventId,
      type: 'guest.rating.submitted',
      payload: {},
      aggregateId: PORTAL_ID,
    })
    const store = createAtomicMetricCommandStore(db, randomUUID)
    const sourceReceipt = {
      eventId: sourceEventId,
      consumerName: 'metric.guest-analytics',
    }

    const firstEntries = ratingFanoutEntries(sourceEventId)
    await expect(
      store.recordMetrics({
        readings: firstEntries,
        sourceReceipt,
      }),
    ).resolves.toHaveLength(3)
    const secondEntries = ratingFanoutEntries(sourceEventId)
    await expect(
      store.recordMetrics({
        readings: secondEntries,
        sourceReceipt,
      }),
    ).resolves.toEqual(
      firstEntries.map((entry) => ({
        status: 'duplicate',
        existingReadingId: entry.reading.id,
      })),
    )
    expect(await readingAndReceiptCounts(sourceEventId)).toEqual([
      { reading_count: 3, receipt_count: 1 },
    ])

    const missingReading = firstEntries[2]!
    await pool.query('DELETE FROM metric_readings WHERE id = $1', [
      missingReading.reading.id,
    ])
    const healingEntries = ratingFanoutEntries(sourceEventId)
    const healed = await store.recordMetrics({
      readings: healingEntries,
      sourceReceipt,
    })
    expect(healed.map(({ status }) => status)).toEqual([
      'duplicate',
      'duplicate',
      'recorded',
    ])
    const healedCount = await pool.query(
      'SELECT count(*)::int AS count FROM metric_readings WHERE source_event_id = $1',
      [sourceEventId],
    )
    expect(healedCount.rows).toEqual([{ count: 3 }])

    await expect(
      store.recordMetrics({
        readings: ratingFanoutEntries(missingSourceEventId),
        sourceReceipt: {
          eventId: missingSourceEventId,
          consumerName: 'metric.guest-analytics',
        },
      }),
    ).rejects.toThrow(/Failed query/u)
    expect(await readingAndReceiptCounts(missingSourceEventId)).toEqual([
      { reading_count: 0, receipt_count: 0 },
    ])
  })

  it('commits every rating retraction with one receipt or rolls all back', async () => {
    const originalSourceEventId = '4f000000-0000-4000-8000-000000000041'
    const retractionEventId = '4f000000-0000-4000-8000-000000000042'
    const missingRetractionEventId = '4f000000-0000-4000-8000-000000000043'
    const store = createAtomicMetricCommandStore(db, randomUUID)
    const originalEntries = ratingFanoutEntries(originalSourceEventId)
    await store.recordMetrics({ readings: originalEntries })
    await seedGuestSourceEvent(pool, {
      id: retractionEventId,
      type: 'guest.rating.retracted',
      payload: {},
      aggregateId: PORTAL_ID,
    })
    const commands = RATING_FANOUT_DEFINITIONS.map((definition) => ({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      portalId: PORTAL_ID,
      definitionVersionId: definition.id,
      sourceEventId: retractionEventId,
      supersedesSourceEventId: originalSourceEventId,
      occurredAt: NOW,
      staffAttribution: null,
    }))
    const receipt = {
      eventId: retractionEventId,
      consumerName: 'metric.guest-analytics',
    }

    const first = await store.retractMetrics(commands, receipt)
    expect(first.map(({ status }) => status)).toEqual([
      'retracted',
      'retracted',
      'retracted',
    ])
    const second = await store.retractMetrics(commands, receipt)
    expect(second.map(({ status }) => status)).toEqual([
      'duplicate',
      'duplicate',
      'duplicate',
    ])
    expect(await correctionAndReceiptCounts(retractionEventId)).toEqual([
      { correction_count: 3, receipt_count: 1 },
    ])

    await expect(
      store.retractMetrics(
        commands.map((command) => ({
          ...command,
          sourceEventId: missingRetractionEventId,
        })),
        {
          eventId: missingRetractionEventId,
          consumerName: 'metric.guest-analytics',
        },
      ),
    ).rejects.toThrow(/Failed query/u)
    expect(await correctionAndReceiptCounts(missingRetractionEventId)).toEqual([
      { correction_count: 0, receipt_count: 0 },
    ])
  })

  it('retracts a specific Guest source fact without replacing it with zero', async () => {
    const store = createAtomicMetricCommandStore(db, randomUUID)
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
    await recordOne(store, { reading })

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
    await expect(retractOne(store, command)).resolves.toEqual({
      status: 'retracted',
      correctedReadingId: READING_ID,
    })
    await expect(retractOne(store, command)).resolves.toEqual({
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

  it("never retracts another organization's reading that shares every other coordinate", async () => {
    const store = createAtomicMetricCommandStore(db, randomUUID)
    const otherReading = makeReading({
      id: OTHER_READING_ID,
      definitionVersionId: '11111111-1111-4111-8111-111111111303',
      metricKey: 'portal.rating_average',
      organizationId: OTHER_ORG_ID,
      propertyId: OTHER_PROP_ID,
      portalId: OTHER_PORTAL_ID,
      value: 4,
      sourceEventId: 'guest-rating-source-other-tenant',
      sourcePolicy: 'first_party_guest_gateway_metric',
      retentionClass: 'guest_gateway_24_month',
    })
    await recordOne(store, {
      reading: otherReading,
    })

    // Property, Portal, definition and superseded source all name the other
    // tenant's reading; only the organization is the caller's own.
    await expect(
      retractOne(store, {
        organizationId: ORG_ID,
        propertyId: OTHER_PROP_ID,
        portalId: OTHER_PORTAL_ID,
        definitionVersionId: otherReading.definitionVersionId,
        sourceEventId: 'guest-rating-retracted-other-tenant',
        supersedesSourceEventId: otherReading.sourceEventId,
        occurredAt: new Date('2026-06-01T12:30:00.000Z'),
        staffAttribution: null,
      }),
    ).resolves.toEqual({ status: 'source_reading_not_found' })

    const corrections = await pool.query(
      'SELECT id FROM metric_corrections WHERE reading_id = $1',
      [OTHER_READING_ID],
    )
    expect(corrections.rows).toHaveLength(0)
    const correctedFacts = await pool.query(
      `SELECT id FROM outbox_events
       WHERE organization_id = ANY($1) AND event_type = 'metric.corrected'`,
      [TENANT_IDS],
    )
    expect(correctedFacts.rows).toHaveLength(0)
  })
})
