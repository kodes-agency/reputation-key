// Migration 0055 against real PostgreSQL: a rating corrected before the fix
// left the earlier rating count and rating average readings effective, because
// only the first of the three readings got its retraction. The migration adds
// the missing retractions and nothing else. It is hand-written SQL, run here
// against rows seeded in the shape the old code stored.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import type { PortalGroupPublicApi } from '#/contexts/portal/application/public-api'
import type { GoalMetricAggregateQuery } from '../application/ports/metric.repository'
import { METRIC_VERSION_IDS } from '../domain/metric-registry'
import { createGoalMetricSourceStatus } from './repositories/goal-metric-source-status'

const ROOT = join(import.meta.dirname, '..', '..', '..', '..')
const MIGRATION = readFileSync(
  join(ROOT, 'drizzle', '0055_retract_replaced_rating_readings.sql'),
  'utf8',
)
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0)

const ORG = organizationId('org-rating-correction-repair')
const PROPERTY = propertyId('73000000-0000-4000-8000-000000000001')
const PORTAL = portalId('73000000-0000-4000-8000-000000000002')
const RATING = METRIC_VERSION_IDS.portalRatingAnalytics
const COUNT = METRIC_VERSION_IDS.portalRatingCountGoal
const AVERAGE = METRIC_VERSION_IDS.portalRatingAverageGoal
const COMPLETENESS = METRIC_VERSION_IDS.configurationCompleteness
const SOURCE_AT = '2026-09-15T12:00:00.000Z'
const REPLACEMENT_AT = '2026-09-15T12:20:00.000Z'

const MEASURES = [
  { version: RATING, key: 'portal.rating', policy: 'first_party_guest_private' },
  {
    version: COUNT,
    key: 'portal.rating_count',
    policy: 'first_party_guest_gateway_metric',
  },
  {
    version: AVERAGE,
    key: 'portal.rating_average',
    policy: 'first_party_guest_gateway_metric',
  },
] as const

/** Distinct ids per case: `7300000N-…-0000000000SS`, S = which fact. */
const ids = (caseNumber: number) => ({
  source: `73000000-0000-4000-8${caseNumber}00-000000000a01`,
  replacement: `73000000-0000-4000-8${caseNumber}00-000000000a02`,
  withdrawal: `73000000-0000-4000-8${caseNumber}00-000000000a03`,
})

const noGroups: PortalGroupPublicApi = {
  findGroupForPortal: async () => null,
  getGroupPortalIds: async () => [],
  findGroupIdsByPortalIds: async () => [],
  portalGroupBelongsToProperty: async () => false,
  getGroupInfo: async () => null,
}

let pool: Pool
const db = getDb()

async function insertReading(
  version: string,
  key: string,
  policy: string,
  sourceEventId: string,
  eventAt: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO metric_readings (
       organization_id, property_id, portal_id, metric_key, value,
       definition_version_id, source_event_id, source_policy, exact_value,
       sample_count, attribution_quality, recorded_at, event_at,
       property_local_date, data_quality, retention_class
     ) VALUES ($1, $2, $3, $4, 4, $5, $6, $7, 4, 1, 'exact', $8, $8,
               '2026-09-15', 'exact', 'guest_gateway_24_month')`,
    [ORG, PROPERTY, PORTAL, key, version, sourceEventId, policy, eventAt],
  )
}

async function insertCorrection(
  sourceEventKey: string,
  readingSource: string,
  version: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO metric_corrections (
       reading_id, source_event_id, kind, reason, actor_type, actor_id, event_at
     )
     SELECT id, $1, 'retract', 'source_reconciliation', 'system', 'portal-workflow', $4
     FROM metric_readings
     WHERE organization_id = $2 AND source_event_id = $3 AND definition_version_id = $5`,
    [sourceEventKey, ORG, readingSource, REPLACEMENT_AT, version],
  )
}

/** A rating and its correction as the old code left them: only the first reading retracted. */
async function seedOldCorrection(caseNumber: number): Promise<void> {
  const { source, replacement } = ids(caseNumber)
  for (const measure of MEASURES) {
    await insertReading(measure.version, measure.key, measure.policy, source, SOURCE_AT)
    await insertReading(
      measure.version,
      measure.key,
      measure.policy,
      replacement,
      REPLACEMENT_AT,
    )
  }
  await insertCorrection(`${replacement}:retract`, source, RATING)
}

async function seedSourceFact(
  eventId: string,
  occurredAt: string,
  supersedes: string | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO outbox_events (
       id, event_type, event_version, payload, organization_id, property_id,
       source_context, source_aggregate_id, created_at, published_at
     ) VALUES ($1, 'guest.rating.submitted', 1, jsonb_strip_nulls(jsonb_build_object(
         'organizationId', $2::text, 'propertyId', $3::text, 'portalId', $4::text,
         'occurredAt', $5::text, 'value', 4, 'supersedesSourceEventId', $6::text
       )), $2, $3, 'guest', $4, $5::timestamptz, $5::timestamptz)`,
    [eventId, ORG, PROPERTY, PORTAL, occurredAt, supersedes],
  )
  await pool.query(
    `INSERT INTO event_consumer_receipts (event_id, consumer_name, status)
     VALUES ($1, 'metric.guest-analytics', 'applied')`,
    [eventId],
  )
}

async function runMigration(): Promise<void> {
  for (const statement of MIGRATION) await pool.query(statement)
}

type CorrectionRow = Readonly<{
  source_event_id: string
  reading_source: string
  definition_version_id: string
  actor_id: string
  reason: string
  event_at: Date
}>

async function corrections(): Promise<readonly CorrectionRow[]> {
  const { rows } = await pool.query<CorrectionRow>(
    `SELECT correction.source_event_id, reading.source_event_id AS reading_source,
            reading.definition_version_id::text AS definition_version_id,
            correction.actor_id, correction.reason, correction.event_at
     FROM metric_corrections AS correction
     JOIN metric_readings AS reading ON reading.id = correction.reading_id
     WHERE reading.organization_id = $1
     ORDER BY correction.source_event_id, reading.definition_version_id`,
    [ORG],
  )
  return rows
}

async function clean(): Promise<void> {
  await pool.query(
    `DELETE FROM metric_corrections
     WHERE reading_id IN (SELECT id FROM metric_readings WHERE organization_id = $1)`,
    [ORG],
  )
  await pool.query('DELETE FROM metric_readings WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG])
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Rating Correction Repair', $1, now()) ON CONFLICT (id) DO NOTHING`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Repair Property', 'rating-correction-repair-property', 'UTC')
     ON CONFLICT (id) DO NOTHING`,
    [PROPERTY, ORG],
  )
  await pool.query(
    `INSERT INTO portals (
       id, organization_id, property_id, entity_type, entity_id, name, slug,
       publication_state
     ) VALUES ($1, $2, $3::uuid, 'property', $3::text, 'Repair Portal',
               'rating-correction-repair-portal', 'published')
     ON CONFLICT (id) DO NOTHING`,
    [PORTAL, ORG, PROPERTY],
  )
})

beforeEach(clean)

afterAll(async () => {
  await clean()
  await pool.query('DELETE FROM portals WHERE id = $1', [PORTAL])
  await pool.query('DELETE FROM properties WHERE id = $1', [PROPERTY])
  await deleteTestOrganizations(pool, [ORG])
  await pool.end()
})

describe.sequential('migration 0055 (retract replaced rating readings)', () => {
  it('adds the retraction the replaced count and average readings are missing, under their own measure', async () => {
    await seedOldCorrection(1)
    const { source, replacement } = ids(1)

    await runMigration()

    expect(await corrections()).toEqual([
      expect.objectContaining({
        source_event_id: `${replacement}:${COUNT}`,
        reading_source: source,
        definition_version_id: COUNT,
        actor_id: 'migration-0055',
        reason: 'source_reconciliation',
        event_at: new Date(REPLACEMENT_AT),
      }),
      expect.objectContaining({
        source_event_id: `${replacement}:${AVERAGE}`,
        reading_source: source,
        definition_version_id: AVERAGE,
        actor_id: 'migration-0055',
      }),
      expect.objectContaining({
        source_event_id: `${replacement}:retract`,
        reading_source: source,
        definition_version_id: RATING,
        actor_id: 'portal-workflow',
      }),
    ])
  })

  it('changes nothing the second time it runs', async () => {
    await seedOldCorrection(1)

    await runMigration()
    const first = await corrections()
    await runMigration()

    expect(await corrections()).toEqual(first)
    expect(first).toHaveLength(3)
  })

  it('leaves a rating whose siblings were already retracted, and one that was withdrawn, as they are', async () => {
    const healed = ids(2)
    await seedOldCorrection(2)
    await insertCorrection(`${healed.replacement}:${COUNT}`, healed.source, COUNT)
    await insertCorrection(`${healed.replacement}:${AVERAGE}`, healed.source, AVERAGE)
    const withdrawn = ids(3)
    await seedOldCorrection(3)
    await insertCorrection(
      `${withdrawn.withdrawal}:${AVERAGE}`,
      withdrawn.source,
      AVERAGE,
    )
    const before = await corrections()

    await runMigration()

    const added = (await corrections()).filter(
      (row) => !before.some((known) => known.source_event_id === row.source_event_id),
    )
    expect(added.map((row) => row.source_event_id)).toEqual([
      `${withdrawn.replacement}:${COUNT}`,
    ])
  })

  it('adds nothing for a correction of a single reading', async () => {
    const { source, replacement } = ids(4)
    for (const sourceEventId of [source, replacement]) {
      await insertReading(
        COMPLETENESS,
        'portal.configuration_completeness',
        'first_party_workflow',
        sourceEventId,
        SOURCE_AT,
      )
    }
    await insertCorrection(`${replacement}:retract`, source, COMPLETENESS)
    const before = await corrections()

    await runMigration()

    expect(await corrections()).toEqual(before)
  })

  it('adds nothing for a reading the correcting fact never replaced', async () => {
    const { replacement } = ids(5)
    await seedOldCorrection(5)
    await pool.query(
      `DELETE FROM metric_readings
       WHERE organization_id = $1 AND source_event_id = $2 AND definition_version_id = $3`,
      [ORG, replacement, AVERAGE],
    )
    await pool.query(
      `DELETE FROM metric_readings
       WHERE organization_id = $1 AND source_event_id = $2 AND definition_version_id = $3`,
      [ORG, replacement, COUNT],
    )

    await runMigration()

    expect((await corrections()).map((row) => row.source_event_id)).toEqual([
      `${replacement}:retract`,
    ])
  })

  it('takes a Goal on the rating count out of quarantine', async () => {
    const { source, replacement } = ids(1)
    await seedOldCorrection(1)
    await seedSourceFact(source, SOURCE_AT, null)
    await seedSourceFact(replacement, REPLACEMENT_AT, source)
    const query: GoalMetricAggregateQuery = {
      organizationId: ORG,
      propertyId: PROPERTY,
      definitionVersionId: COUNT,
      expectedMetricKey: 'portal.rating_count',
      allowedSourcePolicies: ['first_party_guest_gateway_metric'],
      subject: { kind: 'portal', portalId: PORTAL },
      periodStart: new Date('2026-09-01T00:00:00.000Z'),
      periodEnd: new Date('2026-10-01T00:00:00.000Z'),
    }
    const status = createGoalMetricSourceStatus(db, noGroups)
    const events = ['guest.rating.submitted', 'guest.rating.retracted']

    await expect(status.inspect(query, events)).resolves.toMatchObject({
      state: 'quarantined',
      reason: 'correction_missing',
    })

    await runMigration()

    await expect(status.inspect(query, events)).resolves.toMatchObject({
      state: 'complete',
      relevantFactCount: 2,
    })
  })
})
