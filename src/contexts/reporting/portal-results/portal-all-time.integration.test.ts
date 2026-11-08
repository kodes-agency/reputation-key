import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool, type QueryConfig } from 'pg'
import { getEnv } from '#/shared/config/env'
import { getDb, type Database } from '#/shared/db'
import {
  metricReadingId,
  organizationId,
  portalId,
  propertyId,
} from '#/shared/domain/ids'
import { asAccountAdmin } from '#/shared/testing/authorized-reads'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  recordMetric,
  type RecordMetricInput,
} from '../application/use-cases/record-metric'
import { createAtomicMetricCommandStore } from '../readings/metric-command-store.server'
import { METRIC_VERSION_IDS } from '../readings/contracts'
import { createMetricRegistryRepository } from '../infrastructure/repositories/metric-registry.repository'
import { createPropertyLocalDateResolver } from '../infrastructure/repositories/property-local-date'
import { createPortalAnalyticsRepository } from './portal-analytics.repository.server'
import { getPortalAnalytics } from './get-portal-analytics.server'

const db = getDb()
const ORG = organizationId('org-portal-all-time')
const OTHER_ORG = organizationId('org-portal-all-time-other')
const PROPERTY = propertyId('e7100000-0000-4000-8000-000000000001')
const OTHER_PROPERTY = propertyId('e7100000-0000-4000-8000-000000000002')
const PORTAL = portalId('e7200000-0000-4000-8000-000000000001')
const OTHER_PORTAL = portalId('e7200000-0000-4000-8000-000000000002')
const EMPTY_PORTAL = portalId('e7200000-0000-4000-8000-000000000003')
const NOW = new Date('2026-11-08T12:00:00.000Z')
const ACTED_AT = new Date('2026-11-07T12:00:00.000Z')
const LINK = 'e7300000-0000-4000-8000-000000000001'
const store = createAtomicMetricCommandStore(db, randomUUID)
const write = recordMetric({
  commandStore: store,
  registry: createMetricRegistryRepository(),
  clock: () => NOW,
  idGen: () => metricReadingId(randomUUID()),
  resolvePropertyLocalDate: createPropertyLocalDateResolver(db),
})

async function record(
  version: string,
  value = 1,
  overrides: Partial<RecordMetricInput> = {},
): Promise<string> {
  const sourceEventId = randomUUID()
  const result = await write({
    organizationId: ORG,
    propertyId: PROPERTY,
    portalId: PORTAL,
    portalGroupId: null,
    definitionVersionId: version,
    sourceEventId,
    sourcePolicy:
      version === METRIC_VERSION_IDS.qualifiedScanGoal
        ? 'first_party_guest_gateway_metric'
        : version === METRIC_VERSION_IDS.portalDestinationClickAnalytics
          ? 'review_solicitation_analytics_only'
          : 'first_party_guest_private',
    scope: 'portal',
    value,
    sampleCount: 1,
    occurredAt: ACTED_AT,
    attributionQuality: 'exact',
    ...overrides,
  })
  expect(result.status).toBe('recorded')
  return sourceEventId
}

function read(
  selectedPortal = PORTAL,
  database: Pick<Database, 'select' | 'transaction'> = db,
) {
  return asAccountAdmin(
    getPortalAnalytics({
      portalMetrics: createPortalAnalyticsRepository(database, () => NOW),
      propertyAccess: async () => null,
      responseIntegrity: {
        getPortalResponseIntegritySummary: async () => ({
          accepted: 0,
          filteredAutomatically: 0,
          underReview: 0,
          total: 0,
        }),
        getPortalRatingLanguages: async () => ({
          total: 0,
          languages: [],
          unrecorded: 0,
        }),
        getPortalScanPatterns: async () => [],
      },
      portalVersions: {
        listPublicationActivationsBetween: async () => [],
        listResultsLinks: async () => ({
          enabled: true,
          rows: [{ linkId: LINK, label: 'Menu', iconKey: null }],
        }),
      },
    }),
  )({
    organizationId: ORG,
    propertyId: PROPERTY,
    portalId: selectedPortal,
    startDate: new Date(0),
    endDate: NOW,
    timeRange: 'all',
    propertyTimezone: 'UTC',
  })
}

async function clean() {
  await db.execute(sql`
    DELETE FROM metric_corrections WHERE reading_id IN (
      SELECT id FROM metric_readings WHERE organization_id IN (${ORG}, ${OTHER_ORG})
    )
  `)
  await db.execute(
    sql`DELETE FROM metric_readings WHERE organization_id IN (${ORG}, ${OTHER_ORG})`,
  )
  await db.execute(
    sql`DELETE FROM outbox_events WHERE organization_id IN (${ORG}, ${OTHER_ORG})`,
  )
  await db.execute(
    sql`DELETE FROM portal_metric_lifetime_aggregates WHERE organization_id IN (${ORG}, ${OTHER_ORG})`,
  )
}

beforeAll(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  for (const [organization, property] of [
    [ORG, PROPERTY],
    [OTHER_ORG, OTHER_PROPERTY],
  ] as const) {
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${organization}, 'Portal totals', ${organization}, now())
    `)
    await db.execute(sql`
      INSERT INTO properties (id, organization_id, name, slug, timezone)
      VALUES (${property}, ${organization}, 'Portal totals', ${property}, 'UTC')
    `)
  }
  for (const [organization, property, portal] of [
    [ORG, PROPERTY, PORTAL],
    [ORG, PROPERTY, EMPTY_PORTAL],
    [OTHER_ORG, OTHER_PROPERTY, OTHER_PORTAL],
  ] as const) {
    await db.execute(sql`
      INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug, publication_state)
      VALUES (${portal}, ${organization}, ${property}, 'property', ${property}, 'Portal totals', ${portal}, 'published')
    `)
  }
})
beforeEach(clean)
afterAll(async () => {
  await clean()
  await db.execute(
    sql`DELETE FROM portals WHERE organization_id IN (${ORG}, ${OTHER_ORG})`,
  )
  await db.execute(
    sql`DELETE FROM properties WHERE organization_id IN (${ORG}, ${OTHER_ORG})`,
  )
  await deleteTestOrganizations(db, [ORG, OTHER_ORG])
  clearEventSchemas()
})

describe.sequential('All Time from retained effective readings', () => {
  it('reads every figure and destination from readings even when the stored aggregate disagrees', async () => {
    await record(METRIC_VERSION_IDS.qualifiedScanGoal)
    await record(METRIC_VERSION_IDS.portalFeedbackAnalytics)
    for (const stars of [1, 3, 4, 5, 5])
      await record(METRIC_VERSION_IDS.portalRatingAnalytics, stars)
    await record(METRIC_VERSION_IDS.portalDestinationClickAnalytics, 1, {
      destinationKind: 'google_review',
    })
    await record(METRIC_VERSION_IDS.portalDestinationClickAnalytics, 1, {
      destinationKind: 'secondary_link',
      portalLinkId: LINK,
    })
    await record(METRIC_VERSION_IDS.qualifiedScanGoal, 1, { portalId: EMPTY_PORTAL })
    await record(METRIC_VERSION_IDS.qualifiedScanGoal, 1, {
      organizationId: OTHER_ORG,
      propertyId: OTHER_PROPERTY,
      portalId: OTHER_PORTAL,
    })
    await db.execute(sql`
      INSERT INTO portal_metric_lifetime_aggregates (organization_id, property_id, portal_id, qualified_scan_count)
      VALUES (${ORG}, ${PROPERTY}, ${PORTAL}, 999)
      ON CONFLICT (organization_id, property_id, portal_id) DO UPDATE SET qualified_scan_count = 999
    `)

    const result = await read()
    expect(result.kpis.scans.value).toBe(1)
    expect(result.kpis.ratings.value).toBe(5)
    expect(result.kpis.feedback.value).toBe(1)
    expect(result.kpis.avgRating.value).toBe(3.6)
    expect(result.kpis.avgRating.sampleCount).toBe(5)
    expect(result.ratingDistribution.filter((row) => row.count > 0)).toEqual([
      { stars: 1, count: 1 },
      { stars: 3, count: 1 },
      { stars: 4, count: 1 },
      { stars: 5, count: 2 },
    ])
    expect(result.kpis.googleOpens.value).toBe(1)
    expect(result.linkTaps).toMatchObject({ total: 1, rows: [{ linkId: LINK, taps: 1 }] })
    expect(result.comparePeriod).toBeNull()
    expect(result.series).toBeNull()
    expect(result.versionMarkers).toEqual([])
    for (const kpi of [
      result.kpis.scans,
      result.kpis.ratings,
      result.kpis.feedback,
      result.kpis.googleOpens,
    ]) {
      expect(kpi.priorValue).toBeNull()
      expect(kpi.trend).toBeNull()
    }
    expect(result.kpis.avgRating.comparison).toBeNull()
  })

  it('applies a correction once and withdrawals immediately, preserving the small-sample count', async () => {
    const scan = await record(METRIC_VERSION_IDS.qualifiedScanGoal)
    const feedback = await record(METRIC_VERSION_IDS.portalFeedbackAnalytics)
    const source = await record(METRIC_VERSION_IDS.portalRatingAnalytics, 5)
    for (const stars of [4, 4, 4, 4])
      await record(METRIC_VERSION_IDS.portalRatingAnalytics, stars)
    const replacement = await record(METRIC_VERSION_IDS.portalRatingAnalytics, 1, {
      supersedesSourceEventId: source,
    })
    const replay = await write({
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      portalGroupId: null,
      definitionVersionId: METRIC_VERSION_IDS.portalRatingAnalytics,
      sourceEventId: replacement,
      supersedesSourceEventId: source,
      sourcePolicy: 'first_party_guest_private',
      scope: 'portal',
      value: 1,
      sampleCount: 1,
      occurredAt: ACTED_AT,
      attributionQuality: 'exact',
    })
    expect(replay.status).toBe('duplicate')
    const corrected = await read()
    expect(corrected.kpis.ratings.value).toBe(5)
    expect(corrected.kpis.avgRating.value).toBe(3.4)
    expect(corrected.ratingDistribution.filter((row) => row.count > 0)).toEqual([
      { stars: 1, count: 1 },
      { stars: 4, count: 4 },
    ])

    const command = {
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      definitionVersionId: METRIC_VERSION_IDS.portalRatingAnalytics,
      sourceEventId: randomUUID(),
      supersedesSourceEventId: replacement,
      occurredAt: NOW,
      staffAttribution: null,
    }
    expect((await store.retractMetric(command)).status).toBe('retracted')
    expect((await store.retractMetric(command)).status).toBe('duplicate')
    for (const [definitionVersionId, supersedesSourceEventId] of [
      [METRIC_VERSION_IDS.qualifiedScanGoal, scan],
      [METRIC_VERSION_IDS.portalFeedbackAnalytics, feedback],
    ] as const) {
      expect(
        (
          await store.retractMetric({
            ...command,
            definitionVersionId,
            supersedesSourceEventId,
            sourceEventId: randomUUID(),
          })
        ).status,
      ).toBe('retracted')
    }
    const withdrawn = await read()
    expect(withdrawn.kpis.scans.value).toBe(0)
    expect(withdrawn.kpis.feedback.value).toBe(0)
    expect(withdrawn.kpis.ratings.value).toBe(4)
    expect(withdrawn.kpis.avgRating.value).toBeNull()
    expect(withdrawn.kpis.avgRating.sampleCount).toBe(4)
    expect(withdrawn.ratingDistribution).toEqual([])
  })

  it('keeps totals, evidence and star mix in one snapshot while a withdrawal commits', async () => {
    const withdrawnSource = await record(METRIC_VERSION_IDS.portalRatingAnalytics, 1)
    for (const stars of [2, 3, 4, 5, 5])
      await record(METRIC_VERSION_IDS.portalRatingAnalytics, stars)

    const readerPool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 1 })
    const readerClient = await readerPool.connect()
    const query = readerClient.query.bind(readerClient)
    let withdrawalCommitted = false
    readerClient.query = (async (
      config: string | QueryConfig<unknown[]>,
      values?: unknown[],
    ) => {
      const result = await query(config, values)
      // Hold the first totals result after PostgreSQL has read it. The other
      // connection commits before this reader can ask for evidence or star mix.
      if (
        !withdrawalCommitted &&
        result.fields.some((field) => field.name === 'metric_key')
      ) {
        expect(
          (
            await store.retractMetric({
              organizationId: ORG,
              propertyId: PROPERTY,
              portalId: PORTAL,
              definitionVersionId: METRIC_VERSION_IDS.portalRatingAnalytics,
              sourceEventId: randomUUID(),
              supersedesSourceEventId: withdrawnSource,
              occurredAt: NOW,
              staffAttribution: null,
            })
          ).status,
        ).toBe('retracted')
        withdrawalCommitted = true
      }
      return result
    }) as typeof readerClient.query

    try {
      const concurrent = await read(PORTAL, drizzle(readerClient))
      expect(withdrawalCommitted).toBe(true)
      expect(concurrent.kpis.ratings.value).toBe(6)
      expect(concurrent.kpis.avgRating.sampleCount).toBe(6)
      expect(concurrent.kpis.avgRating.value).toBe(3.3)
      expect(concurrent.kpis.avgRating.evidence.correctionHead).toBeNull()
      expect(concurrent.ratingDistribution.filter((row) => row.count > 0)).toEqual([
        { stars: 1, count: 1 },
        { stars: 2, count: 1 },
        { stars: 3, count: 1 },
        { stars: 4, count: 1 },
        { stars: 5, count: 2 },
      ])

      const after = await read()
      expect(after.kpis.ratings.value).toBe(5)
      expect(after.kpis.avgRating.sampleCount).toBe(5)
      expect(after.kpis.avgRating.value).toBe(3.8)
      expect(after.kpis.avgRating.evidence.correctionHead).toBeInstanceOf(Date)
      expect(after.ratingDistribution.filter((row) => row.count > 0)).toEqual([
        { stars: 2, count: 1 },
        { stars: 3, count: 1 },
        { stars: 4, count: 1 },
        { stars: 5, count: 2 },
      ])
    } finally {
      readerClient.query = query
      readerClient.release()
      await readerPool.end()
    }
  })

  it('serves complete zero without a prebuilt aggregate', async () => {
    const result = await read(EMPTY_PORTAL)
    expect(result.kpis.scans.value).toBe(0)
    expect(result.kpis.ratings.value).toBe(0)
    expect(result.kpis.feedback.value).toBe(0)
    expect(result.kpis.googleOpens.value).toBe(0)
    expect(result.kpis.avgRating.value).toBeNull()
    expect(result.kpis.scans.evidence.state).toBe('ready')
  })

  it('withholds a pending source count instead of presenting zero', async () => {
    await db.execute(sql`
      INSERT INTO outbox_events (id, event_type, event_version, payload, organization_id, property_id, source_context, source_aggregate_id, created_at, published_at)
      VALUES (${randomUUID()}::uuid, 'guest.qualified_scan.recorded', 1,
        ${JSON.stringify({ organizationId: ORG, propertyId: PROPERTY, portalId: PORTAL, occurredAt: ACTED_AT.toISOString() })}::jsonb,
        ${ORG}, ${PROPERTY}, 'guest', ${PORTAL}, ${ACTED_AT}, ${ACTED_AT})
    `)
    const result = await read()
    expect(result.kpis.scans.value).toBeNull()
    expect(result.kpis.scans.evidence).toMatchObject({
      state: 'updating',
      availabilityReason: 'consumer_receipt_pending',
    })
    expect(result.kpis.feedback.value).toBe(0)
  })
})
