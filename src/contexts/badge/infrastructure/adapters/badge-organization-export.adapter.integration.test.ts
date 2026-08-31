import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { buildOrganizationExportBundle } from '#/contexts/identity/application/organization-export-contract'
import { ORGANIZATION_LIFECYCLE_CONTEXTS } from '#/contexts/identity/domain/organization-lifecycle'
import { buildBadgeContext } from '../../build'
import { createBadgeOrganizationExportContributor } from './badge-organization-export.adapter'

let lease: TestLease
let db: Database

const suffix = randomUUID()
const ORGANIZATION_ID = `badge-export-org-${suffix}`
const EMPTY_ORGANIZATION_ID = `badge-export-empty-${suffix}`
const PROPERTY_ID = randomUUID()
const PORTAL_GROUP_ID = randomUUID()
const ENABLEMENT_ID = randomUUID()
const LEGACY_AWARD_ID = randomUUID()
const ACTIVATION_ID = randomUUID()
const BOARD_SNAPSHOT_ID = randomUUID()
const GOVERNED_AWARD_ID = randomUUID()
const STATUS_FACT_ID = randomUUID()

const ORGANIZATION_IDS = [ORGANIZATION_ID, EMPTY_ORGANIZATION_ID] as const

/**
 * The Badge and Metric definition catalogues are global, migration-seeded, and
 * deliberately NOT exported. The fixture resolves them at runtime instead of
 * hardcoding seed ids so the test proves the join keys, not the seed file.
 */
let badgeDefinitionId = ''
let badgeDefinitionVersionId = ''
let metricDefinitionId = ''
let metricDefinitionVersionId = ''

const PERIOD_START = '2025-07-01T00:00:00.000Z'
const PERIOD_END = '2025-08-01T00:00:00.000Z'

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
  db = drizzle(lease.pool) as Database

  const definitions = await lease.pool.query<{
    id: string
    badge_definition_id: string
    metric_definition_version_id: string
  }>(
    `SELECT id, badge_definition_id, metric_definition_version_id
     FROM badge_definition_versions ORDER BY id LIMIT 1`,
  )
  const definition = definitions.rows[0]
  if (!definition) throw new Error('badge definition catalogue is not seeded')
  badgeDefinitionVersionId = definition.id
  badgeDefinitionId = definition.badge_definition_id
  metricDefinitionVersionId = definition.metric_definition_version_id

  const metricDefinitions = await lease.pool.query<{ definition_id: string }>(
    'SELECT definition_id FROM metric_definition_versions WHERE id = $1',
    [metricDefinitionVersionId],
  )
  const metricDefinition = metricDefinitions.rows[0]
  if (!metricDefinition) throw new Error('metric definition catalogue is not seeded')
  metricDefinitionId = metricDefinition.definition_id

  for (const organizationId of ORGANIZATION_IDS) {
    await lease.pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'Badge Export Fixture', $1, NOW())`,
      [organizationId],
    )
  }
  await lease.pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Badge Export Property', $3, 'UTC')`,
    [PROPERTY_ID, ORGANIZATION_ID, `property-${PROPERTY_ID}`],
  )
  await lease.pool.query(
    `INSERT INTO portal_groups
       (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, 'Front Desk Group', NOW(), NOW())`,
    [PORTAL_GROUP_ID, ORGANIZATION_ID, PROPERTY_ID],
  )
  await lease.pool.query(
    `INSERT INTO organization_badge_enablements
       (id, organization_id, badge_definition_id, enabled)
     VALUES ($1, $2, $3, false)`,
    [ENABLEMENT_ID, ORGANIZATION_ID, badgeDefinitionId],
  )
  await lease.pool.query(
    `INSERT INTO badge_awards
       (id, badge_definition_id, criteria_version, target_type, target_id,
        organization_id, property_id, awarded_at, unique_key)
     VALUES ($1, $2, 1, 'property', $3, $4, $3, $5, $6)`,
    [
      LEGACY_AWARD_ID,
      badgeDefinitionId,
      PROPERTY_ID,
      ORGANIZATION_ID,
      PERIOD_END,
      `legacy-award-${suffix}`,
    ],
  )
  await lease.pool.query(
    `INSERT INTO recognition_activations
       (id, organization_id, property_id, capability_policy_version, jurisdiction,
        notice_status, consultation_status, metric_definition_version_id,
        aggregation, period_kind, minimum_exposure, minimum_sample,
        freshness_seconds, minimum_completeness, audience, acknowledged_by,
        acknowledged_at, effective_from, status, employment_decision_eligible)
     VALUES ($1, $2, $3, 'recognition/2025-06', 'us', 'completed', 'not_required',
             $4, 'ratio', 'monthly', 5, 5, 86400, 0.90000,
             'property_managers_and_scoped_staff', 'user-admin', $5, $5,
             'active', false)`,
    [
      ACTIVATION_ID,
      ORGANIZATION_ID,
      PROPERTY_ID,
      metricDefinitionVersionId,
      PERIOD_START,
    ],
  )
  await lease.pool.query(
    `INSERT INTO recognition_board_snapshots
       (id, organization_id, property_id, activation_id, metric_definition_id,
        metric_definition_version_id, aggregation, period_kind, period_start,
        period_end, timezone, minimum_exposure, minimum_sample, freshness_seconds,
        minimum_completeness, source_watermark, status, correction_generation,
        employment_decision_eligible, reconciled_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'ratio', 'monthly', $7, $8, 'UTC',
             5, 5, 86400, 0.90000, $8, 'ready', 0, false, $8)`,
    [
      BOARD_SNAPSHOT_ID,
      ORGANIZATION_ID,
      PROPERTY_ID,
      ACTIVATION_ID,
      metricDefinitionId,
      metricDefinitionVersionId,
      PERIOD_START,
      PERIOD_END,
    ],
  )
  await lease.pool.query(
    `INSERT INTO recognition_awards
       (id, organization_id, property_id, portal_group_id, definition_version_id,
        metric_definition_version_id, source_snapshot_id, source_fact_id,
        source_watermark, period_start, period_end, timezone, sample_count,
        exposure_count, completeness, eligibility_reason, definition_snapshot,
        awarded_at, employment_decision_eligible)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $9, 'UTC', 12, 30, 0.95000,
             'threshold_met', $11::jsonb, $9, false)`,
    [
      GOVERNED_AWARD_ID,
      ORGANIZATION_ID,
      PROPERTY_ID,
      PORTAL_GROUP_ID,
      badgeDefinitionVersionId,
      metricDefinitionVersionId,
      BOARD_SNAPSHOT_ID,
      `source-fact-${suffix}`,
      PERIOD_END,
      PERIOD_START,
      JSON.stringify({
        name: 'Configuration Ready',
        icon: 'award',
        criteria: 'threshold',
        rule: 'ratio >= 0.9',
        metricVersion: metricDefinitionVersionId,
      }),
    ],
  )
  await lease.pool.query(
    `INSERT INTO recognition_award_status_facts
       (id, organization_id, property_id, award_id, status, reason, occurred_at)
     VALUES ($1, $2, $3, $4, 'invalidated', 'source correction', $5)`,
    [STATUS_FACT_ID, ORGANIZATION_ID, PROPERTY_ID, GOVERNED_AWARD_ID, PERIOD_END],
  )
})

/** Governed Recognition facts are append-only in production; fixture teardown
 * is the one place that may lift those triggers, and only inside its own
 * transaction so a rollback restores them. */
const APPEND_ONLY_TABLES = [
  'recognition_award_status_facts',
  'recognition_awards',
  'recognition_board_snapshots',
] as const

const TEARDOWN_TABLES = [
  'recognition_award_status_facts',
  'recognition_awards',
  'recognition_board_snapshots',
  'recognition_activations',
  'badge_awards',
  'organization_badge_enablements',
  'portal_groups',
  'properties',
] as const

afterAll(async () => {
  const organizationIds = [...ORGANIZATION_IDS]
  const client = await lease.pool.connect()
  try {
    await client.query('BEGIN')
    for (const table of APPEND_ONLY_TABLES) {
      await client.query(`ALTER TABLE ${table} DISABLE TRIGGER ${table}_append_only`)
    }
    for (const table of TEARDOWN_TABLES) {
      await client.query(`DELETE FROM ${table} WHERE organization_id = ANY($1::text[])`, [
        organizationIds,
      ])
    }
    for (const table of APPEND_ONLY_TABLES) {
      await client.query(`ALTER TABLE ${table} ENABLE TRIGGER ${table}_append_only`)
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  await deleteTestOrganizations(lease.pool, organizationIds)
  await lease.release()
})

describe.sequential('Badge Organization Export contributor (real PostgreSQL)', () => {
  it('exports enablements and both award generations deterministically', async () => {
    const contributor = createBadgeOrganizationExportContributor(db)
    const asOf = new Date(Date.now() - 1000)

    const first = await contributor.contribute({
      organizationId: ORGANIZATION_ID,
      requestId: randomUUID(),
      asOf,
    })
    const replay = await contributor.contribute({
      organizationId: ORGANIZATION_ID,
      requestId: randomUUID(),
      asOf,
    })

    expect(first).toEqual(replay)
    expect(first.coverage).toBe('complete')
    expect(first.omissionCodes).toEqual([])
    expect(first.entries.map(({ path }) => path)).toEqual([
      'badge/enablements.csv',
      'badge/enablements.json',
      'badge/awards.csv',
      'badge/awards.json',
    ])

    const enablements = JSON.parse(
      Buffer.from(
        first.entries.find(({ path }) => path === 'badge/enablements.json')!.bytes,
      ).toString('utf8'),
    ) as { enablements: readonly Record<string, unknown>[] }
    expect(enablements.enablements).toEqual([
      expect.objectContaining({
        id: ENABLEMENT_ID,
        badge_definition_id: badgeDefinitionId,
        enabled: false,
      }),
    ])

    const awards = JSON.parse(
      Buffer.from(
        first.entries.find(({ path }) => path === 'badge/awards.json')!.bytes,
      ).toString('utf8'),
    ) as {
      legacyAwards: readonly Record<string, unknown>[]
      governedAwards: readonly Record<string, unknown>[]
      governedAwardStatusFacts: readonly Record<string, unknown>[]
    }
    expect(awards.legacyAwards).toEqual([
      expect.objectContaining({ id: LEGACY_AWARD_ID, target_type: 'property' }),
    ])
    expect(awards.governedAwards).toEqual([
      expect.objectContaining({
        id: GOVERNED_AWARD_ID,
        portal_group_id: PORTAL_GROUP_ID,
        employment_decision_eligible: false,
      }),
    ])
    // The correcting status fact travels with the award it corrects, so the
    // archive shows the corrected outcome rather than the original claim alone.
    expect(awards.governedAwardStatusFacts).toEqual([
      expect.objectContaining({
        id: STATUS_FACT_ID,
        award_id: GOVERNED_AWARD_ID,
        status: 'invalidated',
      }),
    ])
  })

  it('never copies the global badge definition catalogue into a tenant archive', async () => {
    const contribution = await createBadgeOrganizationExportContributor(db).contribute({
      organizationId: ORGANIZATION_ID,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
    })
    const archive = contribution.entries
      .map(({ bytes }) => Buffer.from(bytes).toString('utf8'))
      .join('\n')

    const catalogue = await lease.pool.query<{ key: string; name: string }>(
      'SELECT key, name FROM badge_definitions WHERE id = $1',
      [badgeDefinitionId],
    )
    const row = catalogue.rows[0]!
    expect(archive).not.toContain(row.key)
    expect(archive).not.toContain('criteria_json')
    expect(archive).not.toContain('badge_definitions')
  })

  it('answers no_data for an Organization with no Recognition history', async () => {
    expect(
      await createBadgeOrganizationExportContributor(db).contribute({
        organizationId: EMPTY_ORGANIZATION_ID,
        requestId: randomUUID(),
        asOf: new Date(Date.now() - 1000),
      }),
    ).toEqual({
      context: 'badge',
      coverage: 'no_data',
      omissionCodes: [],
      entries: [],
    })
  })

  it('is accepted by the Organization Export bundle builder', async () => {
    const contributor = createBadgeOrganizationExportContributor(db)
    const bundle = await buildOrganizationExportBundle({
      organizationId: ORGANIZATION_ID,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
      contributors: ORGANIZATION_LIFECYCLE_CONTEXTS.map((context) =>
        context === 'badge'
          ? contributor
          : {
              context,
              contribute: async () => ({
                context,
                coverage: 'no_data' as const,
                omissionCodes: [],
                entries: [],
              }),
            },
      ),
    })

    expect(bundle.entries.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        'badge/enablements.csv',
        'badge/awards.json',
        'manifest.json',
      ]),
    )
  })

  it('contributing does not enable any Badge capability', async () => {
    await createBadgeOrganizationExportContributor(db).contribute({
      organizationId: ORGANIZATION_ID,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
    })
    const context = buildBadgeContext()

    expect(Object.keys(context.publicApi)).toEqual([])
    expect(Object.keys(context.internal.repos)).toEqual([])
    expect(Object.keys(context.internal.useCases)).toEqual([])
  })
})
