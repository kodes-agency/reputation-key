import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import type { Database } from '#/shared/db'
import * as schema from '#/shared/db/schema'
import { getEnv } from '#/shared/config/env'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { METRIC_VERSION_IDS } from '#/contexts/metric/domain/metric-registry'
import { getFleetOverview } from '../../application/use-cases/get-fleet-overview'
import {
  createFleetOverviewProjectionAdapter,
  FLEET_OVERVIEW_STATEMENT_BOUND,
} from './fleet-overview-projection.adapter'

const NOW = new Date('2026-08-09T12:00:00.000Z')
const ORG = organizationId('org-fleet-projection-integration')
const PROPERTY_COUNT = 5_000
const REVIEW_IDS = [
  'f1000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000002',
  'f1000000-0000-4000-8000-000000000003',
  'f1000000-0000-4000-8000-000000000004',
] as const

function fleetProperties(count = PROPERTY_COUNT) {
  return Array.from({ length: count }, (_, index) => ({
    propertyId: propertyId(
      `f0000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
    ),
    name: `Fleet ${String(index + 1).padStart(5, '0')}`,
    slug: `fleet-${index + 1}`,
    timezone: 'UTC',
  }))
}

const properties = fleetProperties()
let pool: Pool
let statementCount = 0
let db: Database

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  await pool.query(
    `DELETE FROM metric_corrections
     WHERE source_event_id = 'fleet-correction-1'`,
  )
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM organization WHERE id = $1', [ORG])
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Fleet projection integration', 'fleet-projection-integration', now())`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     SELECT fixture.id, $1, fixture.name, fixture.slug, 'UTC'
     FROM unnest($2::uuid[], $3::text[], $4::text[])
       AS fixture(id, name, slug)`,
    [
      ORG,
      properties.map((property) => property.propertyId),
      properties.map((property) => property.name),
      properties.map((property) => property.slug),
    ],
  )

  const first = properties[0]!
  const reviews = [
    [REVIEW_IDS[0], 'current', 4, '2026-08-01T12:00:00.000Z', '2026-09-01T00:00:00.000Z'],
    [REVIEW_IDS[1], 'prior', 5, '2026-06-20T12:00:00.000Z', '2026-09-01T00:00:00.000Z'],
    [REVIEW_IDS[2], 'expired', 1, '2026-08-02T12:00:00.000Z', '2026-08-08T00:00:00.000Z'],
    [REVIEW_IDS[3], 'clockless', 1, '2026-08-03T12:00:00.000Z', null],
  ] as const
  for (const [id, externalId, rating, reviewedAt, contentExpiresAt] of reviews) {
    await pool.query(
      `INSERT INTO reviews (
         id, organization_id, property_id, platform, external_id,
         external_location_id, rating, reviewed_at, expires_at, content_expires_at,
         source_epoch, source_revision, analysis_sequence,
         ai_source_byte_length, ai_source_digest
       ) VALUES ($1, $2, $3, 'google', $4, 'locations/fleet', $5, $6, $7, $8, 0, 0, 0, 1, repeat('0', 64))`,
      [
        id,
        ORG,
        first.propertyId,
        `fleet-${externalId}`,
        rating,
        reviewedAt,
        contentExpiresAt ?? '2026-09-01T00:00:00.000Z',
        contentExpiresAt,
      ],
    )
  }
  await pool.query(
    `INSERT INTO replies (review_id, organization_id, text, status, source)
     VALUES ($1, $2, 'Published', 'published', 'internal')`,
    [REVIEW_IDS[0], ORG],
  )
  await pool.query(
    `INSERT INTO organization_capability (organization_id, capability)
     VALUES ($1, 'portal.read')`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO property_capability (property_id, capability)
     VALUES ($1, 'portal.read')`,
    [first.propertyId],
  )
  for (const [ordinal, versionId, property, value, eventAt] of [
    [
      1,
      METRIC_VERSION_IDS.propertyReviewDashboard,
      first.propertyId,
      4,
      '2026-08-01T12:00:00Z',
    ],
    [
      2,
      METRIC_VERSION_IDS.propertyReviewDashboard,
      first.propertyId,
      5,
      '2026-06-20T12:00:00Z',
    ],
    [
      3,
      METRIC_VERSION_IDS.portalScanAnalytics,
      first.propertyId,
      7,
      '2026-08-01T12:00:00Z',
    ],
    [
      4,
      METRIC_VERSION_IDS.portalScanAnalytics,
      properties[1]!.propertyId,
      9,
      '2026-08-01T12:00:00Z',
    ],
  ] as const) {
    await pool.query(
      `INSERT INTO metric_readings (
         organization_id, property_id, metric_key, value, definition_version_id,
         source_event_id, source_policy, exact_value, sample_count,
         attribution_quality, recorded_at, event_at, property_local_date,
         data_quality, retention_class
       )
       SELECT $1, $2, metric_definitions.metric_key, $3::real, $4, $5,
         CASE WHEN metric_definitions.metric_key = 'property.review'
           THEN 'google_property_derivative'
           ELSE 'review_solicitation_analytics_only'
         END,
         $3::numeric, 1, 'exact', $6, $6,
         to_char($6::timestamptz, 'YYYY-MM-DD'), 'exact', 'standard'
       FROM metric_definition_versions
       JOIN metric_definitions ON metric_definitions.id = metric_definition_versions.definition_id
       WHERE metric_definition_versions.id = $4`,
      [ORG, property, value, versionId, `fleet-source-${ordinal}`, eventAt],
    )
  }
  await pool.query(
    `INSERT INTO metric_corrections (
       reading_id, source_event_id, kind, reason, actor_type, actor_id,
       exact_delta, event_at, recorded_at
     )
     SELECT id, 'fleet-correction-1', 'adjust', 'verified source correction',
       'system', 'fleet-test', 0.5, '2026-08-02T12:00:00Z', '2026-08-02T12:00:00Z'
     FROM metric_readings
     WHERE organization_id = $1 AND source_event_id = 'fleet-source-1'`,
    [ORG],
  )

  db = drizzle(pool, {
    schema,
    logger: {
      logQuery() {
        statementCount += 1
      },
    },
  }) as unknown as Database
})

afterAll(async () => {
  await pool.query(
    `DELETE FROM metric_corrections
     WHERE source_event_id = 'fleet-correction-1'`,
  )
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM organization WHERE id = $1', [ORG])
  await pool.end()
})

describe('fleet overview projection integration', () => {
  it('pages the real getFleetOverview projection at constant query count for 5,000 properties', async () => {
    const observed: unknown[] = []
    const projection = createFleetOverviewProjectionAdapter(db, {
      onRead: (evidence) => observed.push(evidence),
    })
    const getFleet = getFleetOverview({
      projection,
      resolveAccessiblePropertyIds: async () => null,
      clock: () => NOW,
    })
    const input = {
      organizationId: ORG,
      scope: {
        userId: userId('fleet-projection-reader'),
        organizationWide: true,
      },
      portalReadEnabled: true,
      goalReadEnabled: true,
      slaHours: 48,
      startDate: new Date('2026-07-10T12:00:00.000Z'),
      endDate: NOW,
      timeRange: '30d' as const,
    }

    statementCount = 0
    const firstPage = await getFleet(input)
    const fleetStatements = statementCount
    statementCount = 0
    const secondPage = await getFleet({
      ...input,
      cursor: firstPage.nextCursor ?? undefined,
    })

    expect(firstPage.entries).toHaveLength(50)
    expect(secondPage.entries).toHaveLength(50)
    expect(firstPage.totals.propertyCount).toBe(PROPERTY_COUNT)
    expect(secondPage.totals.propertyCount).toBe(PROPERTY_COUNT)
    expect(firstPage.nextCursor).not.toBeNull()
    expect(new Set(firstPage.entries.map((entry) => entry.propertyId))).not.toEqual(
      new Set(secondPage.entries.map((entry) => entry.propertyId)),
    )
    expect(
      firstPage.entries.some((first) =>
        secondPage.entries.some((second) => second.propertyId === first.propertyId),
      ),
    ).toBe(false)
    expect(fleetStatements).toBe(statementCount)
    expect(fleetStatements).toBe(4)
    expect(fleetStatements).toBeLessThanOrEqual(FLEET_OVERVIEW_STATEMENT_BOUND)
    expect(observed).toContainEqual({
      propertyCount: PROPERTY_COUNT,
      returnedRows: 50,
      statementCount: 4,
      statementBound: FLEET_OVERVIEW_STATEMENT_BOUND,
      withinBound: true,
    })

    expect(firstPage.entries[0]).toMatchObject({
      reviewCount: 1,
      avgRating: 4.5,
      avgRatingTrend: -10,
      scanCount: 7,
      reviewEvidence: {
        definitionVersionId: METRIC_VERSION_IDS.propertyReviewDashboard,
        freshness: 'stale',
        completeness: 1,
        correctionCount: 1,
      },
      scanEvidence: {
        definitionVersionId: METRIC_VERSION_IDS.portalScanAnalytics,
        freshness: 'stale',
        completeness: 1,
        correctionCount: 0,
      },
      attentionSignals: { unanswered: 1, ratingDrop: true },
      totalAttention: 2,
    })
    expect(firstPage.entries[1]).toMatchObject({
      scanCount: 0,
      feedbackCount: 0,
      scanEvidence: null,
      feedbackEvidence: null,
    })
  }, 30_000)

  it('applies a singleton property-access scope without widening it', async () => {
    const scopedProperty = properties[0]!
    const getFleet = getFleetOverview({
      projection: createFleetOverviewProjectionAdapter(db),
      resolveAccessiblePropertyIds: async () => [scopedProperty.propertyId],
      clock: () => NOW,
    })

    const result = await getFleet({
      organizationId: ORG,
      scope: {
        userId: userId('fleet-projection-scoped-reader'),
        organizationWide: false,
      },
      portalReadEnabled: true,
      goalReadEnabled: true,
      slaHours: 48,
      startDate: new Date('2026-07-10T12:00:00.000Z'),
      endDate: NOW,
      timeRange: '30d',
    })

    expect(result.totals.propertyCount).toBe(1)
    expect(result.entries.map((entry) => entry.propertyId)).toEqual([
      scopedProperty.propertyId,
    ])
  })
})
