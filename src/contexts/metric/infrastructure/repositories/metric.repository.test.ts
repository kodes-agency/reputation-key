import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type {
  GoalMetricAggregateQuery,
  MetricReadingsQuery,
} from '../../application/ports/metric.repository'
import { createMetricRepository } from './metric.repository'

const ORG_ID = organizationId('org-metricrepo-0000-0000-0000-000000000001')
const PROP_ID = propertyId('4f000000-0000-4000-8000-000000000001')
const NOW = new Date('2026-08-08T12:00:00Z')
const PROPERTY_REVIEW_VERSION = '11111111-1111-4111-8111-111111111205'
const PORTAL_RATING_VERSION = '11111111-1111-4111-8111-111111111202'
const CONTENT_REVIEW_VERSION = '11111111-1111-4111-8111-111111111101'
const RATING_COUNT_VERSION = '11111111-1111-4111-8111-111111111302'
const RATING_AVERAGE_VERSION = '11111111-1111-4111-8111-111111111303'

let pool: Pool
let nextReading = 1

const query = (
  metricKey: MetricReadingsQuery['metricKey'],
  consumer: MetricReadingsQuery['consumer'],
): MetricReadingsQuery => ({
  organizationId: ORG_ID,
  propertyId: PROP_ID,
  portalId: null,
  groupId: null,
  metricKey,
  consumer,
})

const goalQuery = (
  definitionVersionId: string,
  expectedMetricKey: GoalMetricAggregateQuery['expectedMetricKey'],
): GoalMetricAggregateQuery => ({
  organizationId: ORG_ID,
  propertyId: PROP_ID,
  definitionVersionId,
  expectedMetricKey,
  allowedSourcePolicies: ['first_party_guest_gateway_metric'],
  subject: { kind: 'property', propertyId: PROP_ID },
  periodStart: new Date('2026-08-08T00:00:00.000Z'),
  periodEnd: new Date('2026-08-09T00:00:00.000Z'),
})

async function insertReading(
  input: Readonly<{
    versionId: string
    metricKey: MetricReadingsQuery['metricKey']
    sourcePolicy: string
    value: number
    sampleCount?: number
  }>,
): Promise<string> {
  const id = `4f000000-0000-4000-8000-${String(nextReading++).padStart(12, '0')}`
  await pool.query(
    `INSERT INTO metric_readings (
       id, organization_id, property_id, portal_id, group_id, metric_key,
       value, recorded_at, definition_version_id, source_event_id,
       source_policy, exact_value, numerator, denominator, sample_count,
       attribution_quality, event_at, property_local_date, data_quality,
       retention_class
     ) VALUES (
       $1, $2, $3, NULL, NULL, $4,
       $5::real, $6, $7, $8,
       $9, $5::numeric, NULL, NULL, $10,
       'exact', $6, '2026-08-08', 'exact', 'standard'
     )`,
    [
      id,
      ORG_ID,
      PROP_ID,
      input.metricKey,
      input.value,
      NOW,
      input.versionId,
      `metric-repository-source-${id}`,
      input.sourcePolicy,
      input.sampleCount ?? 1,
    ],
  )
  return id
}

async function clean(): Promise<void> {
  await pool.query(
    `DELETE FROM metric_corrections
     WHERE reading_id IN (SELECT id FROM metric_readings WHERE organization_id = $1)`,
    [ORG_ID],
  )
  await pool.query('DELETE FROM metric_readings WHERE organization_id = $1', [ORG_ID])
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Metric Repository Org', 'metric-repository-org', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [ORG_ID],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Metric Repository Property', 'metric-repository-property', 'UTC', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROP_ID, ORG_ID],
  )
})

beforeEach(async () => {
  nextReading = 1
  await clean()
})

afterAll(async () => {
  await clean()
  await pool.query('DELETE FROM properties WHERE id = $1', [PROP_ID])
  await deleteTestOrganizations(pool, [ORG_ID])
  await pool.end()
})

describe.sequential('governed metric aggregate reader (integration)', () => {
  it('returns exact values only to a consumer permitted by the immutable version', async () => {
    await insertReading({
      versionId: PROPERTY_REVIEW_VERSION,
      metricKey: 'property.review',
      sourcePolicy: 'google_property_derivative',
      value: 4,
    })
    const repository = createMetricRepository(getDb(), () => NOW)

    await expect(
      repository.queryAggregate(query('property.review', 'dashboard')),
    ).resolves.toEqual({
      sum: 4,
      count: 1,
      max: 4,
      available: true,
      sampleCount: 1,
      minimumSample: 1,
    })
    await expect(
      repository.queryAggregate(query('property.review', 'goal')),
    ).resolves.toEqual({
      sum: 0,
      count: 0,
      max: 0,
      available: false,
      sampleCount: 0,
      minimumSample: 1,
    })
  })

  it('returns unavailable rather than a partial value below the minimum sample', async () => {
    for (const value of [4, 5]) {
      await insertReading({
        versionId: PORTAL_RATING_VERSION,
        metricKey: 'portal.rating',
        sourcePolicy: 'first_party_guest_private',
        value,
      })
    }
    const repository = createMetricRepository(getDb(), () => NOW)

    await expect(
      repository.queryAggregate(query('portal.rating', 'portal_analytics')),
    ).resolves.toEqual({
      sum: 0,
      count: 0,
      max: 0,
      available: false,
      sampleCount: 2,
      minimumSample: 5,
    })
  })

  it('uses the tip of append-only correction lineage without changing the source reading', async () => {
    const readingId = await insertReading({
      versionId: CONTENT_REVIEW_VERSION,
      metricKey: 'portal.content_review.completed',
      sourcePolicy: 'first_party_workflow',
      value: 2,
    })
    const firstCorrectionId = '4f000000-0000-4000-8000-000000000101'
    await pool.query(
      `INSERT INTO metric_corrections (
         id, reading_id, source_event_id, kind, reason, actor_type, actor_id,
         exact_delta, replacement_value, event_at
       ) VALUES ($1, $2, 'metric-correction-source-1', 'replace', 'source correction',
                 'system', 'metric-reconciliation', NULL, 10, $3)`,
      [firstCorrectionId, readingId, NOW],
    )
    await pool.query(
      `INSERT INTO metric_corrections (
         id, reading_id, source_event_id, kind, reason, actor_type, actor_id,
         exact_delta, replacement_value, event_at, supersedes_correction_id
       ) VALUES ('4f000000-0000-4000-8000-000000000102', $1,
                 'metric-correction-source-2', 'adjust', 'reconciled delta',
                 'system', 'metric-reconciliation', 3, NULL, $2, $3)`,
      [readingId, NOW, firstCorrectionId],
    )
    const repository = createMetricRepository(getDb(), () => NOW)

    await expect(
      repository.queryAggregate(query('portal.content_review.completed', 'goal')),
    ).resolves.toMatchObject({ sum: 5, count: 1, max: 5, available: true })
    const source = await pool.query(
      'SELECT exact_value FROM metric_readings WHERE id = $1',
      [readingId],
    )
    expect(Number(source.rows[0]?.exact_value)).toBe(2)
  })

  it('excludes ambiguous legacy rows from governed reads', async () => {
    await pool.query(
      `INSERT INTO metric_readings (
         id, organization_id, property_id, metric_key, value, recorded_at
       ) VALUES ('4f000000-0000-4000-8000-000000000201', $1, $2,
                 'property.review', 5, $3)`,
      [ORG_ID, PROP_ID, NOW],
    )
    const repository = createMetricRepository(getDb(), () => NOW)

    await expect(
      repository.queryAggregate(query('property.review', 'dashboard')),
    ).resolves.toEqual({
      sum: 0,
      count: 0,
      max: 0,
      available: false,
      sampleCount: 0,
      minimumSample: 1,
    })
  })

  it('pins Goal reads to one immutable version and a half-open period', async () => {
    await insertReading({
      versionId: RATING_COUNT_VERSION,
      metricKey: 'portal.rating_count',
      sourcePolicy: 'first_party_guest_gateway_metric',
      value: 1,
    })
    await pool.query(
      `INSERT INTO metric_readings (
         id, organization_id, property_id, metric_key, value, recorded_at,
         definition_version_id, source_event_id, source_policy, exact_value,
         sample_count, attribution_quality, event_at, property_local_date,
         data_quality, retention_class
       ) VALUES (
         '4f000000-0000-4000-8000-000000000301', $1, $2,
         'portal.rating_count', 1, $3, $4, 'period-end-source',
         'first_party_guest_gateway_metric', 1, 1, 'exact', $3,
         '2026-08-09', 'exact', 'guest_gateway_24_month'
       )`,
      [ORG_ID, PROP_ID, new Date('2026-08-09T00:00:00.000Z'), RATING_COUNT_VERSION],
    )
    const repository = createMetricRepository(getDb(), () => NOW)

    await expect(
      repository.queryGoalAggregate(
        goalQuery(RATING_COUNT_VERSION, 'portal.rating_count'),
      ),
    ).resolves.toMatchObject({
      sum: 1,
      weightedSum: 1,
      sampleCount: 1,
      readingCount: 1,
      invalidDefinitionCount: 0,
      invalidSourceCount: 0,
    })
  })

  it('weights averages by eligible samples and excludes retracted facts', async () => {
    const first = await insertReading({
      versionId: RATING_AVERAGE_VERSION,
      metricKey: 'portal.rating_average',
      sourcePolicy: 'first_party_guest_gateway_metric',
      value: 5,
      sampleCount: 2,
    })
    await insertReading({
      versionId: RATING_AVERAGE_VERSION,
      metricKey: 'portal.rating_average',
      sourcePolicy: 'first_party_guest_gateway_metric',
      value: 3,
      sampleCount: 1,
    })
    const repository = createMetricRepository(getDb(), () => NOW)
    await expect(
      repository.queryGoalAggregate(
        goalQuery(RATING_AVERAGE_VERSION, 'portal.rating_average'),
      ),
    ).resolves.toMatchObject({
      sum: 8,
      weightedSum: 13,
      sampleCount: 3,
      readingCount: 2,
    })

    await pool.query(
      `INSERT INTO metric_corrections (
         id, reading_id, source_event_id, kind, reason, actor_type, actor_id,
         exact_delta, replacement_value, event_at, recorded_at
       ) VALUES (
         '4f000000-0000-4000-8000-000000000302', $1,
         'goal-reader-retraction', 'retract', 'guest_fact_retracted',
         'system', 'guest.gateway', NULL, NULL, $2, $2
       )`,
      [first, NOW],
    )

    await expect(
      repository.queryGoalAggregate(
        goalQuery(RATING_AVERAGE_VERSION, 'portal.rating_average'),
      ),
    ).resolves.toMatchObject({
      sum: 3,
      weightedSum: 3,
      sampleCount: 1,
      readingCount: 1,
      correctionHead: NOW,
    })
  })
})
