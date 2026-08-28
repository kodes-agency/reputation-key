import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { CLASSIFICATIONS_BY_CONTEXT } from '#/contexts/identity/application/ports/organization-export-contributor.port'
import { createMetricOrganizationExportAdapter } from './metric-organization-export.adapter'

// Immutable registry ids seeded by migration 0018 (METRIC_VERSION_IDS).
const RATING_COUNT_GOAL_VERSION = '11111111-1111-4111-8111-111111111302'
const PROPERTY_REVIEW_DASHBOARD_VERSION = '11111111-1111-4111-8111-111111111205'
const PORTAL_SCAN_ANALYTICS_VERSION = '11111111-1111-4111-8111-111111111201'

const organizations = new Set<string>()
let lease: TestLease
let db: Database

type Fixture = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  exportedReadingId: string
  googleDerivedReadingId: string
  analyticsOnlyReadingId: string
  rootCorrectionId: string
  headCorrectionId: string
  sourceEventMarker: string
}>

async function seedOrganization(prefix: string): Promise<string> {
  const organizationId = `${prefix}-${randomUUID()}`
  organizations.add(organizationId)
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Metric Export Fixture', $1, NOW())`,
    [organizationId],
  )
  return organizationId
}

async function seedFixture(): Promise<Fixture> {
  const organizationId = await seedOrganization('metric-export-org')
  const fixture: Fixture = {
    organizationId,
    propertyId: randomUUID(),
    portalId: randomUUID(),
    exportedReadingId: randomUUID(),
    googleDerivedReadingId: randomUUID(),
    analyticsOnlyReadingId: randomUUID(),
    rootCorrectionId: randomUUID(),
    headCorrectionId: randomUUID(),
    sourceEventMarker: `NEVER-EXPORT-SOURCE-EVENT-${randomUUID()}`,
  }

  await lease.pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1::uuid, $2, 'Metric Export Property', $1::text, 'UTC', NOW(), NOW())`,
    [fixture.propertyId, organizationId],
  )
  await lease.pool.query(
    `INSERT INTO portals (
       id, organization_id, property_id, entity_type, entity_id, name, slug,
       created_at, updated_at
     ) VALUES ($1::uuid, $2, $3::uuid, 'property', $3::text, 'Metric Export Portal',
               $1::text, NOW(), NOW())`,
    [fixture.portalId, organizationId, fixture.propertyId],
  )

  const governedReading = `INSERT INTO metric_readings (
      id, organization_id, property_id, portal_id, metric_key, value,
      definition_version_id, source_event_id, source_policy, exact_value,
      sample_count, attribution_quality, recorded_at, event_at,
      property_local_date, data_quality, retention_class
    ) VALUES ($1, $2, $3::uuid, $4, $5, $6::real, $7, $8, $9, $6::numeric, 1, 'exact',
              TIMESTAMPTZ '2026-08-27T10:00:01.000000Z',
              TIMESTAMPTZ '2026-08-27T10:00:00.000000Z',
              '2026-08-27', 'exact', 'guest_gateway_metric')`

  // Exported: its definition version names `export` in permitted_consumers.
  await lease.pool.query(governedReading, [
    fixture.exportedReadingId,
    organizationId,
    fixture.propertyId,
    fixture.portalId,
    'portal.rating_count',
    1,
    RATING_COUNT_GOAL_VERSION,
    `${fixture.sourceEventMarker}-exported`,
    'first_party_guest_gateway_metric',
  ])
  // Public Reputation family (google_property_derivative) — never blended into
  // metric/readings.*, and never exported as a Google-derived reading.
  await lease.pool.query(governedReading, [
    fixture.googleDerivedReadingId,
    organizationId,
    fixture.propertyId,
    null,
    'property.review',
    5,
    PROPERTY_REVIEW_DASHBOARD_VERSION,
    `${fixture.sourceEventMarker}-google`,
    'google_property_derivative',
  ])
  // Portal analytics only: no `export` consumer, so it stays behind too.
  await lease.pool.query(governedReading, [
    fixture.analyticsOnlyReadingId,
    organizationId,
    fixture.propertyId,
    fixture.portalId,
    'portal.scan',
    1,
    PORTAL_SCAN_ANALYTICS_VERSION,
    `${fixture.sourceEventMarker}-analytics`,
    'review_solicitation_analytics_only',
  ])

  // A superseded adjust followed by the current replace tip.
  await lease.pool.query(
    `INSERT INTO metric_corrections (
       id, reading_id, source_event_id, kind, reason, actor_type, actor_id,
       exact_delta, event_at, recorded_at
     ) VALUES ($1, $2, $3, 'adjust', 'first correction', 'system', 'metric-consumer',
               1, TIMESTAMPTZ '2026-08-27T11:00:00Z', TIMESTAMPTZ '2026-08-27T11:00:00Z')`,
    [
      fixture.rootCorrectionId,
      fixture.exportedReadingId,
      `${fixture.sourceEventMarker}-correction-root`,
    ],
  )
  await lease.pool.query(
    `INSERT INTO metric_corrections (
       id, reading_id, source_event_id, kind, reason, actor_type, actor_id,
       replacement_value, supersedes_correction_id, event_at, recorded_at
     ) VALUES ($1, $2, $3, 'replace', 'guest withdrawal', 'system', 'metric-consumer',
               4, $4, TIMESTAMPTZ '2026-08-27T12:00:00Z', TIMESTAMPTZ '2026-08-27T12:00:00Z')`,
    [
      fixture.headCorrectionId,
      fixture.exportedReadingId,
      `${fixture.sourceEventMarker}-correction-head`,
      fixture.rootCorrectionId,
    ],
  )

  await lease.pool.query(
    `INSERT INTO portal_metric_lifetime_aggregates (
       organization_id, property_id, portal_id, qualified_scan_count,
       private_rating_count, private_rating_sum, private_rating_5_count,
       projection_revision, created_at, updated_at
     ) VALUES ($1, $2, $3, 7, 1, 5, 1, 3, NOW(), NOW())`,
    [organizationId, fixture.propertyId, fixture.portalId],
  )
  await lease.pool.query(
    `INSERT INTO metric_current_google_reputation_snapshots (
       property_id, organization_id, source_epoch, source_run_id, source_event_id,
       review_count, average_rating, evaluated_at, updated_at
     ) VALUES ($1, $2, 3, $3, $4, 12, 4.5,
               TIMESTAMPTZ '2026-08-27T09:00:00Z', NOW())`,
    [fixture.propertyId, organizationId, randomUUID(), randomUUID()],
  )
  await lease.pool.query(
    `INSERT INTO metric_source_watermarks (
       consumer_name, source_name, organization_id, property_id,
       definition_version_id, last_source_event_id, last_event_at, updated_at
     ) VALUES ('metric.guest-gateway', 'guest.response.recorded', $1, $2, $3, $4,
               TIMESTAMPTZ '2026-08-27T10:00:00Z', NOW())`,
    [
      organizationId,
      fixture.propertyId,
      RATING_COUNT_GOAL_VERSION,
      `${fixture.sourceEventMarker}-watermark`,
    ],
  )

  // Maintenance and dead-projection surfaces the archive must never reach.
  await lease.pool.query(
    `INSERT INTO metric_quarantine (
       source_event_id, organization_id, property_id, reason, payload_hash
     ) VALUES ($1, $2, $3, 'never_export_quarantine_marker', $4)`,
    [
      `${fixture.sourceEventMarker}-quarantine`,
      organizationId,
      fixture.propertyId,
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ],
  )
  await lease.pool.query(
    `INSERT INTO rollup_daily_metrics (
       organization_id, property_id, metric_key, date, count, sum_value, avg_value
     ) VALUES ($1, $2, 'never_export_rollup_marker', TIMESTAMPTZ '2026-08-27T00:00:00Z',
               9, 9, 9)`,
    [organizationId, fixture.propertyId],
  )

  return fixture
}

function decode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf8')
}

describe.sequential('Metric Organization Export contributor', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    db = drizzle(lease.pool) as Database
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    const ids = [...organizations]
    await lease.pool.query(
      `DELETE FROM metric_corrections
       WHERE supersedes_correction_id IS NOT NULL
         AND reading_id IN (SELECT id FROM metric_readings WHERE organization_id = ANY($1))`,
      [ids],
    )
    await lease.pool.query(
      `DELETE FROM metric_corrections
       WHERE reading_id IN (SELECT id FROM metric_readings WHERE organization_id = ANY($1))`,
      [ids],
    )
    for (const table of [
      'metric_readings',
      'metric_quarantine',
      'metric_source_watermarks',
      'portal_metric_lifetime_aggregates',
      'metric_current_google_reputation_snapshots',
      'rollup_daily_metrics',
      'portals',
      'properties',
    ]) {
      await lease.pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [
        ids,
      ])
    }
    await deleteTestOrganizations(lease.pool, ids)
    organizations.clear()
  })

  it('exports the governed Metric contract deterministically and excludes the rest', async () => {
    const fixture = await seedFixture()
    const asOf = new Date(Date.now() - 1000)
    const contributor = createMetricOrganizationExportAdapter(db)

    const first = await contributor.contribute({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf,
    })
    const replay = await contributor.contribute({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf,
    })

    expect(first).toEqual(replay)
    expect(first).toMatchObject({
      context: 'metric',
      coverage: 'complete',
      omissionCodes: [],
    })
    expect(first.entries.map(({ path }) => path)).toEqual([
      'metric/corrections.csv',
      'metric/corrections.json',
      'metric/current-google-reputation.csv',
      'metric/current-google-reputation.json',
      'metric/portal-lifetime.csv',
      'metric/portal-lifetime.json',
      'metric/readings.csv',
      'metric/readings.json',
      'metric/watermarks.csv',
      'metric/watermarks.json',
    ])
    for (const entry of first.entries) {
      expect(CLASSIFICATIONS_BY_CONTEXT.metric).toContain(entry.classification)
    }

    const readings = JSON.parse(
      decode(first.entries.find(({ path }) => path === 'metric/readings.json')!.bytes),
    ) as { records: { metric_reading: readonly Record<string, unknown>[] } }
    expect(readings.records.metric_reading).toHaveLength(1)
    expect(readings.records.metric_reading[0]).toMatchObject({
      id: fixture.exportedReadingId,
      metric_key: 'portal.rating_count',
      definition_version_id: RATING_COUNT_GOAL_VERSION,
      definition_version: 1,
      unit: 'rating',
      property_local_date: '2026-08-27',
      event_at: '2026-08-27T10:00:00.000000Z',
      // The current correction tip, not the superseded adjust and not the
      // original recorded value.
      recorded_exact_value: '1.0000000000',
      effective_exact_value: '4.0000000000',
      correction_state: 'replace',
      correction_head_id: fixture.headCorrectionId,
    })

    const corrections = JSON.parse(
      decode(first.entries.find(({ path }) => path === 'metric/corrections.json')!.bytes),
    ) as { records: { metric_correction: readonly Record<string, unknown>[] } }
    expect(
      corrections.records.metric_correction.map(({ id, is_correction_head }) => ({
        id,
        is_correction_head,
      })),
    ).toEqual([
      { id: fixture.rootCorrectionId, is_correction_head: false },
      { id: fixture.headCorrectionId, is_correction_head: true },
    ])

    const reputation = JSON.parse(
      decode(
        first.entries.find(
          ({ path }) => path === 'metric/current-google-reputation.json',
        )!.bytes,
      ),
    ) as {
      records: { current_google_reputation_snapshot: readonly Record<string, unknown>[] }
    }
    expect(reputation.records.current_google_reputation_snapshot[0]).toEqual({
      property_id: fixture.propertyId,
      source_epoch: 3,
      review_count: 12,
      average_rating: 4.5,
      evaluated_at: '2026-08-27T09:00:00.000000Z',
      updated_at: expect.any(String),
    })

    const archiveText = first.entries.map(({ bytes }) => decode(bytes)).join('\n')
    // Non-export-permitted definition versions, the maintenance surface, the
    // dead rollups, and every ingestion correlation id stay out.
    expect(archiveText).not.toContain('property.review')
    expect(archiveText).not.toContain('portal.scan')
    expect(archiveText).not.toContain(fixture.googleDerivedReadingId)
    expect(archiveText).not.toContain(fixture.analyticsOnlyReadingId)
    expect(archiveText).not.toContain('NEVER-EXPORT-SOURCE-EVENT-')
    expect(archiveText).not.toContain('never_export_quarantine_marker')
    expect(archiveText).not.toContain('never_export_rollup_marker')
  })

  it('answers no_data for an Organization with no governed metric result', async () => {
    const organizationId = await seedOrganization('metric-export-empty-org')

    const contribution = await createMetricOrganizationExportAdapter(db).contribute({
      organizationId,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
    })

    expect(contribution).toEqual({
      context: 'metric',
      coverage: 'no_data',
      omissionCodes: [],
      entries: [],
    })
  })

  it('fails closed when a queued request is outside the bounded snapshot window', async () => {
    const fixture = await seedFixture()

    await expect(
      createMetricOrganizationExportAdapter(db).contribute({
        organizationId: fixture.organizationId,
        requestId: randomUUID(),
        asOf: new Date(Date.now() - 16 * 60 * 1000),
      }),
    ).rejects.toThrow(/snapshot window is unavailable/)
  })
})
