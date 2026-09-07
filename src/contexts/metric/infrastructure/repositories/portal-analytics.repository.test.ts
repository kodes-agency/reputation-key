// Portal analytics reads are bound to EVENT time and bucketed on the
// property's own local date (real PG).
//
// Two defects this pins, both invisible to an in-memory fake because they are
// column choices:
//
//  1. `metricReadings.occurredAt` is the drizzle field for the `recorded_at`
//     column — the INGESTION timestamp (metric.schema.ts says so verbatim;
//     metric-command-store.ts writes `eventAt: reading.occurredAt`). Bounding
//     the analytics window on it meant outbox lag, a retry or a replay moved a
//     guest action into a different day, or out of the window entirely.
//  2. The daily trend bucketed on `DATE(recorded_at)` in the UTC session
//     timezone. `metric_readings.property_local_date` is already computed per
//     row from `properties.timezone` and required by the governed-provenance
//     CHECK — for a property in America/Los_Angeles the UTC bucket pushed every
//     action from 17:00 local onward onto the next day.
//
// The fixture makes both visible at once: a property in America/Los_Angeles,
// two readings that share a local date but straddle UTC midnight, and one
// reading ingested a month after it happened.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import type { Database } from '#/shared/db'
import * as schema from '#/shared/db/schema'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  metricReadingId,
  organizationId,
  portalId,
  propertyId,
  scanEventId,
} from '#/shared/domain/ids'
import { METRIC_VERSION_IDS } from '../../application/public-api'
import { createPortalAnalyticsRepository } from './portal-analytics.repository'
import { createAtomicMetricCommandStore } from '../metric-command-store'
import { createMetricRegistryRepository } from './metric-registry.repository'
import { createPropertyLocalDateResolver } from './property-local-date'
import { recordMetrics } from '../../application/use-cases/record-metric'
import { onScanRecordedDurably } from '../record-portal-metric'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'

const ORG = organizationId('org-portal-metrics-integration')
const PROP = propertyId('c1000000-0000-4000-8000-000000000001')
const PORTAL = portalId('c2000000-0000-4000-8000-000000000001')

// June 2026, half-open bounds, expressed in UTC.
const WINDOW_START = new Date('2026-06-01T00:00:00.000Z')
const WINDOW_END = new Date('2026-07-01T00:00:00.000Z')
const COMPUTED_AT = new Date('2026-07-01T00:05:00.000Z')
const ATOMIC_WINDOW_START = new Date('2026-09-01T00:00:00.000Z')
const ATOMIC_WINDOW_END = new Date('2026-10-01T00:00:00.000Z')
const ATOMIC_OCCURRED_AT = new Date('2026-09-11T10:00:00.000Z')
const ATOMIC_COMPUTED_AT = new Date('2026-10-01T00:05:00.000Z')

const SOURCE_EVENTS = {
  scanPending: 'c3000000-0000-4000-8000-000000000001',
  scanAtomic: 'c3000000-0000-4000-8000-000000000005',
  ratingApplied: 'c3000000-0000-4000-8000-000000000002',
  feedbackObsolete: 'c3000000-0000-4000-8000-000000000003',
  clickAppliedWithoutProjection: 'c3000000-0000-4000-8000-000000000004',
} as const

type Reading = Readonly<{
  sourceEventId: string
  value: number
  /** When the guest acted. */
  eventAt: string
  /** When the outbox landed the reading. */
  recordedAt: string
  /** Computed from properties.timezone by the metric writer. */
  propertyLocalDate: string
}>

// America/Los_Angeles is UTC-7 in June.
const READINGS: readonly Reading[] = [
  // 2026-06-01 13:00 local — same UTC day as its local day.
  {
    sourceEventId: 'portal-metrics-1',
    value: 5,
    eventAt: '2026-06-01T20:00:00.000Z',
    recordedAt: '2026-06-01T20:00:05.000Z',
    propertyLocalDate: '2026-06-01',
  },
  // 2026-06-01 19:00 local — but 2026-06-02 in UTC. DATE(recorded_at) split
  // this into its own bucket; property_local_date keeps it with the reading
  // above.
  {
    sourceEventId: 'portal-metrics-2',
    value: 3,
    eventAt: '2026-06-02T02:00:00.000Z',
    recordedAt: '2026-06-02T02:00:04.000Z',
    propertyLocalDate: '2026-06-01',
  },
  // Ingested 25 days late (replay/outbox lag): recorded_at falls OUTSIDE the
  // June window, event_at falls inside it.
  {
    sourceEventId: 'portal-metrics-3',
    value: 4,
    eventAt: '2026-06-10T18:00:00.000Z',
    recordedAt: '2026-07-05T00:00:00.000Z',
    propertyLocalDate: '2026-06-10',
  },
  // Out-of-range value a future writer could produce. Neither rating read may
  // surface it: no 7★ bucket, no trend point above the chart's 0-5 domain.
  {
    sourceEventId: 'portal-metrics-4',
    value: 7,
    eventAt: '2026-06-20T18:00:00.000Z',
    recordedAt: '2026-06-20T18:00:02.000Z',
    propertyLocalDate: '2026-06-20',
  },
  // Genuinely outside the window on BOTH clocks — must never appear.
  {
    sourceEventId: 'portal-metrics-5',
    value: 1,
    eventAt: '2026-05-15T18:00:00.000Z',
    recordedAt: '2026-05-15T18:00:02.000Z',
    propertyLocalDate: '2026-05-15',
  },
  // Exactly at the exclusive end — belongs to the next period.
  {
    sourceEventId: 'portal-metrics-6',
    value: 2,
    eventAt: '2026-07-01T00:00:00.000Z',
    recordedAt: '2026-07-01T00:00:01.000Z',
    propertyLocalDate: '2026-06-30',
  },
]

let pool: Pool
let db: Database

beforeAll(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG])
  await pool.query(
    `DELETE FROM metric_corrections
     WHERE reading_id IN (
       SELECT id FROM metric_readings WHERE organization_id = $1
     )`,
    [ORG],
  )

  for (const source of [
    [SOURCE_EVENTS.scanPending, 'guest.scan.recorded', '2026-06-11T10:00:00.000Z'],
    [SOURCE_EVENTS.scanAtomic, 'guest.scan.recorded', ATOMIC_OCCURRED_AT.toISOString()],
    [SOURCE_EVENTS.ratingApplied, 'guest.rating.submitted', '2026-06-12T10:00:00.000Z'],
    [
      SOURCE_EVENTS.feedbackObsolete,
      'guest.feedback.submitted',
      '2026-06-13T10:00:00.000Z',
    ],
    [
      SOURCE_EVENTS.clickAppliedWithoutProjection,
      'guest.review_link.clicked',
      '2026-06-14T10:00:00.000Z',
    ],
  ] as const) {
    await pool.query(
      `INSERT INTO outbox_events (
         id, event_type, event_version, payload, organization_id, property_id,
         source_context, source_aggregate_id, created_at, published_at
       ) VALUES (
         $1, $2, 1, jsonb_build_object(
           'organizationId', $3::text,
           'propertyId', $4::text,
           'portalId', $5::text,
           'occurredAt', $6::text
         ), $3, $4, 'guest', $5, $6::timestamptz, $6::timestamptz
       )`,
      [source[0], source[1], ORG, PROP, PORTAL, source[2]],
    )
  }
  await pool.query(
    `INSERT INTO event_consumer_receipts (event_id, consumer_name, status)
     VALUES
       ($1, 'metric.guest-analytics', 'applied'),
       ($2, 'metric.guest-analytics', 'obsolete'),
       ($3, 'metric.guest-analytics', 'applied')`,
    [
      SOURCE_EVENTS.ratingApplied,
      SOURCE_EVENTS.feedbackObsolete,
      SOURCE_EVENTS.clickAppliedWithoutProjection,
    ],
  )
  await pool.query('DELETE FROM portals WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Portal metrics integration', 'portal-metrics-integration', now())`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Portal metrics property', 'portal-metrics-property', 'America/Los_Angeles')`,
    [PROP, ORG],
  )
  // `property_id` is uuid and `entity_id` is varchar, so the reused $3 needs an
  // explicit cast on each side — without them Postgres refuses the statement
  // with "inconsistent types deduced for parameter $3".
  await pool.query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug, publication_state)
     VALUES ($1, $2, $3::uuid, 'property', $3::text, 'Portal metrics portal', 'portal-metrics-portal', 'published')`,
    [PORTAL, ORG, PROP],
  )

  for (const reading of READINGS) {
    await pool.query(
      `INSERT INTO metric_readings (
         organization_id, property_id, portal_id, metric_key, value,
         definition_version_id, source_event_id, source_policy, exact_value,
         sample_count, attribution_quality, recorded_at, event_at,
         property_local_date, data_quality, retention_class
       )
       VALUES ($1, $2, $3, 'portal.rating', $4::real, $5, $6,
         'first_party_guest_private', $4::numeric, 1, 'exact',
         $7, $8, $9, 'exact', 'standard')`,
      [
        ORG,
        PROP,
        PORTAL,
        reading.value,
        METRIC_VERSION_IDS.portalRatingAnalytics,
        reading.sourceEventId,
        reading.recordedAt,
        reading.eventAt,
        reading.propertyLocalDate,
      ],
    )
  }

  // The current correction tip retracts the 3-star reading. Portal analytics
  // must use effective governed values everywhere, not the immutable raw row.
  await pool.query(
    `INSERT INTO metric_corrections (
       reading_id, source_event_id, kind, reason, actor_type, actor_id, event_at
     )
     SELECT id, 'portal-metrics-retract-2', 'retract', 'integrity review',
       'system', 'portal-metrics-test', '2026-06-12T00:00:00.000Z'
     FROM metric_readings
     WHERE organization_id = $1 AND source_event_id = 'portal-metrics-2'`,
    [ORG],
  )

  db = drizzle(pool, { schema }) as unknown as Database
})

afterAll(async () => {
  await pool.query(
    `DELETE FROM metric_corrections
     WHERE reading_id IN (
       SELECT id FROM metric_readings WHERE organization_id = $1
     )`,
    [ORG],
  )
  await pool.query('DELETE FROM metric_readings WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM portals WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
  clearEventSchemas()
  await pool.end()
})

describe('governed Portal analytics repository (integration)', () => {
  it('buckets the daily trend on property_local_date, not the UTC ingestion day', async () => {
    const adapter = createPortalAnalyticsRepository(db, () => COMPUTED_AT)

    const trend = await adapter.getPortalRatingTrend(
      ORG,
      PROP,
      PORTAL,
      WINDOW_START,
      WINDOW_END,
    )

    // 2026-06-01: both source rows share the same local day, but the 3-star
    // row's current correction tip retracts it, leaving the effective 5-star row.
    // 2026-06-10: the late-ingested reading is inside the window on event time.
    // 2026-06-20: excluded — value 7 is outside the 1..5 rating domain.
    expect(trend).toEqual([
      { date: '2026-06-01', avgRating: 5 },
      { date: '2026-06-10', avgRating: 4 },
    ])
  })

  it('includes a late-ingested reading and excludes one that truly predates the window', async () => {
    const adapter = createPortalAnalyticsRepository(db, () => COMPUTED_AT)

    const sums = await adapter.getPortalKpiSums(
      ORG,
      PROP,
      PORTAL,
      WINDOW_START,
      WINDOW_END,
    )

    // Only governed, in-range, currently effective readings count. The 7-star
    // invalid row and retracted 3-star row are excluded; the late-ingested
    // 4-star row remains because the period is bound to business event time.
    expect(sums).toEqual([{ metricKey: 'portal.rating', total: 9, count: 2 }])
  })

  it('constrains the rating distribution to 1..5 stars', async () => {
    const adapter = createPortalAnalyticsRepository(db, () => COMPUTED_AT)

    const distribution = await adapter.getPortalRatingDistribution(
      ORG,
      PROP,
      PORTAL,
      WINDOW_START,
      WINDOW_END,
    )

    // No 7★ bucket, and the pre-window 1★ reading stays out on event time.
    expect(distribution).toEqual([
      { stars: 4, count: 1 },
      { stars: 5, count: 1 },
    ])
  })

  it('distinguishes ready, updating, and unavailable evidence without fabricating zero', async () => {
    const evidence = await createPortalAnalyticsRepository(
      db,
      () => COMPUTED_AT,
    ).getPortalMetricEvidence(ORG, PROP, PORTAL, WINDOW_START, WINDOW_END)

    expect(evidence.scans).toMatchObject({
      definitionVersionId: METRIC_VERSION_IDS.portalScanAnalytics,
      state: 'updating',
      completeness: 0,
      verifiedThrough: null,
      latestActivity: new Date('2026-06-11T10:00:00.000Z'),
      computedAt: COMPUTED_AT,
      availabilityReason: 'consumer_receipt_pending',
    })
    expect(evidence.privateRatings).toMatchObject({
      definitionVersionId: METRIC_VERSION_IDS.portalRatingAnalytics,
      state: 'unavailable',
      verifiedThrough: null,
      availabilityReason: 'invalid_governed_reading',
    })
    expect(evidence.privateRatings.correctionHead).toBeInstanceOf(Date)
    expect(evidence.privateFeedback).toMatchObject({
      definitionVersionId: METRIC_VERSION_IDS.portalFeedbackAnalytics,
      state: 'unavailable',
      completeness: 0,
      availabilityReason: 'source_fact_obsolete',
    })
    expect(evidence.reviewLinkClicks).toMatchObject({
      definitionVersionId: METRIC_VERSION_IDS.portalDestinationClickAnalytics,
      state: 'unavailable',
      verifiedThrough: null,
      latestActivity: new Date('2026-06-14T10:00:00.000Z'),
      computedAt: COMPUTED_AT,
      completeness: 1,
      availabilityReason: 'projection_missing',
    })
  })

  it('marks scan evidence ready after one atomic consumer delivery', async () => {
    const project = recordMetrics({
      commandStore: createAtomicMetricCommandStore(db, randomUUID),
      registry: createMetricRegistryRepository(),
      clock: () => ATOMIC_COMPUTED_AT,
      idGen: () => metricReadingId(randomUUID()),
      resolvePropertyLocalDate: createPropertyLocalDateResolver(db),
    })
    await onScanRecordedDurably({
      recordMetrics: project,
      findGroupForPortal: async () => null,
      logger: {
        warn: () => {},
      },
    })({
      _tag: 'guest.scan.recorded',
      eventId: SOURCE_EVENTS.scanAtomic,
      correlationId: null,
      scanId: scanEventId('c4000000-0000-4000-8000-000000000001'),
      organizationId: ORG,
      propertyId: PROP,
      portalId: PORTAL,
      scanSource: 'qr',
      occurredAt: ATOMIC_OCCURRED_AT,
    })

    const evidence = await createPortalAnalyticsRepository(
      db,
      () => ATOMIC_COMPUTED_AT,
    ).getPortalMetricEvidence(ORG, PROP, PORTAL, ATOMIC_WINDOW_START, ATOMIC_WINDOW_END)
    expect(evidence.scans).toMatchObject({
      state: 'ready',
      completeness: 1,
      availabilityReason: null,
    })
  })

  it('treats a quiet period with no source facts as complete', async () => {
    const evidence = await createPortalAnalyticsRepository(
      db,
      () => COMPUTED_AT,
    ).getPortalMetricEvidence(
      ORG,
      PROP,
      PORTAL,
      new Date('2027-01-01T00:00:00.000Z'),
      new Date('2027-02-01T00:00:00.000Z'),
    )

    for (const family of Object.values(evidence)) {
      expect(family).toMatchObject({
        state: 'ready',
        verifiedThrough: COMPUTED_AT,
        latestActivity: null,
        completeness: 1,
        availabilityReason: null,
      })
    }
  })
})
