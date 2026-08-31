import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { buildOrganizationExportBundle } from '#/contexts/identity/application/organization-export-contract'
import { ORGANIZATION_LIFECYCLE_CONTEXTS } from '#/contexts/identity/domain/organization-lifecycle'
import { buildLeaderboardContext } from '../../build'
import { createLeaderboardOrganizationExportContributor } from './leaderboard-organization-export.adapter'

let lease: TestLease
let db: Database

const suffix = randomUUID()
const ORGANIZATION_ID = `leaderboard-export-org-${suffix}`
const OTHER_ORGANIZATION_ID = `leaderboard-export-other-${suffix}`
const EMPTY_ORGANIZATION_ID = `leaderboard-export-empty-${suffix}`
const PROPERTY_ID = randomUUID()
const OTHER_PROPERTY_ID = randomUUID()
const PORTAL_GROUP_ID = randomUUID()
const ACTIVATION_ID = randomUUID()
const ACTIVATION_GROUP_ID = randomUUID()
const BOARD_SNAPSHOT_ID = randomUUID()
const BOARD_ENTRY_ID = randomUUID()
const RECONCILIATION_EVENT_ID = randomUUID()
const LEGACY_SNAPSHOT_ID = randomUUID()
const LEGACY_ENTRY_ID = randomUUID()
const ORPHAN_SNAPSHOT_ID = randomUUID()

const ORGANIZATION_IDS = [
  ORGANIZATION_ID,
  OTHER_ORGANIZATION_ID,
  EMPTY_ORGANIZATION_ID,
] as const

let metricDefinitionId = ''
let metricDefinitionVersionId = ''

const PERIOD_START = '2025-07-01T00:00:00.000Z'
const PERIOD_END = '2025-08-01T00:00:00.000Z'

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
  db = drizzle(lease.pool) as Database

  const versions = await lease.pool.query<{ id: string; definition_id: string }>(
    'SELECT id, definition_id FROM metric_definition_versions ORDER BY id LIMIT 1',
  )
  const version = versions.rows[0]
  if (!version) throw new Error('metric definition catalogue is not seeded')
  metricDefinitionVersionId = version.id
  metricDefinitionId = version.definition_id

  for (const organizationId of ORGANIZATION_IDS) {
    await lease.pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'Leaderboard Export Fixture', $1, NOW())`,
      [organizationId],
    )
  }
  for (const [organizationId, propertyId] of [
    [ORGANIZATION_ID, PROPERTY_ID],
    [OTHER_ORGANIZATION_ID, OTHER_PROPERTY_ID],
  ] as const) {
    await lease.pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Leaderboard Export Property', $3, 'UTC')`,
      [propertyId, organizationId, `property-${propertyId}`],
    )
  }
  await lease.pool.query(
    `INSERT INTO portal_groups
       (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, 'Front Desk Group', NOW(), NOW())`,
    [PORTAL_GROUP_ID, ORGANIZATION_ID, PROPERTY_ID],
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
    `INSERT INTO recognition_activation_groups
       (id, organization_id, property_id, activation_id, portal_group_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [ACTIVATION_GROUP_ID, ORGANIZATION_ID, PROPERTY_ID, ACTIVATION_ID, PORTAL_GROUP_ID],
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
    `INSERT INTO recognition_board_entries
       (id, organization_id, property_id, snapshot_id, portal_group_id, value,
        numerator, denominator, sample_count, exposure_count, completeness,
        rank, tie_group, eligibility_reason, status, source_watermark,
        correction_generation, employment_decision_eligible, reconciled_at)
     VALUES ($1, $2, $3, $4, $5, 0.5000000000, 5.0000000000, 10.0000000000,
             12, 30, 0.95000, 1, 1, 'threshold_met', 'ranked', $6, 0, false, $6)`,
    [
      BOARD_ENTRY_ID,
      ORGANIZATION_ID,
      PROPERTY_ID,
      BOARD_SNAPSHOT_ID,
      PORTAL_GROUP_ID,
      PERIOD_END,
    ],
  )
  await lease.pool.query(
    `INSERT INTO recognition_reconciliation_events
       (id, organization_id, property_id, metric_definition_version_id,
        source_event_id, source_watermark, processed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [
      RECONCILIATION_EVENT_ID,
      ORGANIZATION_ID,
      PROPERTY_ID,
      metricDefinitionVersionId,
      `source-event-${suffix}`,
      PERIOD_END,
    ],
  )
  // Legacy ranking rows. leaderboard_snapshots has no organization column, so
  // the contributor scopes it through its own organization-scoped entries.
  for (const [snapshotId, period] of [
    [LEGACY_SNAPSHOT_ID, `2025-07-${suffix.slice(0, 4)}`],
    [ORPHAN_SNAPSHOT_ID, `2025-06-${suffix.slice(0, 4)}`],
  ] as const) {
    await lease.pool.query(
      `INSERT INTO leaderboard_snapshots
         (id, property_id, period, scope, metric_key, score_key, last_updated_at)
       VALUES ($1, $2, $3, 'portal', 'qualified_scans', 'overall', $4)`,
      [snapshotId, PROPERTY_ID, period, PERIOD_END],
    )
  }
  await lease.pool.query(
    `INSERT INTO leaderboard_entries
       (id, snapshot_id, rank, target_type, target_id, organization_id,
        property_id, score, metric_value, normalized_score, updated_at)
     VALUES ($1, $2, 1, 'portal', $3, $4, $5, 12.5, 4.5, 0.9, $6)`,
    [
      LEGACY_ENTRY_ID,
      LEGACY_SNAPSHOT_ID,
      randomUUID(),
      ORGANIZATION_ID,
      PROPERTY_ID,
      PERIOD_END,
    ],
  )
})

/** Governed Recognition facts are append-only in production; fixture teardown
 * is the one place that may lift those triggers, and only inside its own
 * transaction so a rollback restores them. */
const APPEND_ONLY_TABLES = [
  'recognition_board_entries',
  'recognition_board_snapshots',
  'recognition_reconciliation_events',
] as const

const TEARDOWN_TABLES = [
  'recognition_board_entries',
  'recognition_board_snapshots',
  'recognition_reconciliation_events',
  'recognition_activation_groups',
  'recognition_activations',
  'leaderboard_entries',
  'portal_groups',
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
    await client.query('DELETE FROM leaderboard_snapshots WHERE id = ANY($1::uuid[])', [
      [LEGACY_SNAPSHOT_ID, ORPHAN_SNAPSHOT_ID],
    ])
    await client.query('DELETE FROM properties WHERE organization_id = ANY($1::text[])', [
      organizationIds,
    ])
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

describe.sequential(
  'Leaderboard Organization Export contributor (real PostgreSQL)',
  () => {
    it('exports Recognition activation, board and legacy ranking rows deterministically', async () => {
      const contributor = createLeaderboardOrganizationExportContributor(db)
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
        'leaderboard/recognition-activations.csv',
        'leaderboard/recognition-activations.json',
        'leaderboard/board-snapshots.csv',
        'leaderboard/board-snapshots.json',
        'leaderboard/entries.csv',
        'leaderboard/entries.json',
      ])

      const activations = JSON.parse(
        Buffer.from(
          first.entries.find(
            ({ path }) => path === 'leaderboard/recognition-activations.json',
          )!.bytes,
        ).toString('utf8'),
      ) as {
        activations: readonly Record<string, unknown>[]
        activationGroups: readonly Record<string, unknown>[]
      }
      expect(activations.activations).toEqual([
        expect.objectContaining({
          id: ACTIVATION_ID,
          jurisdiction: 'us',
          notice_status: 'completed',
          acknowledged_by: 'user-admin',
          employment_decision_eligible: false,
        }),
      ])
      expect(activations.activationGroups).toEqual([
        expect.objectContaining({ id: ACTIVATION_GROUP_ID }),
      ])

      const board = JSON.parse(
        Buffer.from(
          first.entries.find(({ path }) => path === 'leaderboard/board-snapshots.json')!
            .bytes,
        ).toString('utf8'),
      ) as {
        boardSnapshots: readonly Record<string, unknown>[]
        boardEntries: readonly Record<string, unknown>[]
        reconciliationEvents: readonly Record<string, unknown>[]
      }
      expect(board.boardSnapshots).toEqual([
        expect.objectContaining({ id: BOARD_SNAPSHOT_ID, status: 'ready' }),
      ])
      expect(board.boardEntries).toEqual([
        expect.objectContaining({ id: BOARD_ENTRY_ID, rank: 1, status: 'ranked' }),
      ])
      expect(board.reconciliationEvents).toEqual([
        expect.objectContaining({ id: RECONCILIATION_EVENT_ID }),
      ])
    })

    it('scopes a tenant-column-free legacy snapshot through its own entries', async () => {
      const contribution = await createLeaderboardOrganizationExportContributor(
        db,
      ).contribute({
        organizationId: ORGANIZATION_ID,
        requestId: randomUUID(),
        asOf: new Date(Date.now() - 1000),
      })
      const entries = JSON.parse(
        Buffer.from(
          contribution.entries.find(({ path }) => path === 'leaderboard/entries.json')!
            .bytes,
        ).toString('utf8'),
      ) as {
        legacySnapshots: readonly Record<string, unknown>[]
        legacyEntries: readonly Record<string, unknown>[]
      }

      expect(entries.legacyEntries).toEqual([
        expect.objectContaining({ id: LEGACY_ENTRY_ID, rank: 1, score: 12.5 }),
      ])
      expect(entries.legacySnapshots).toEqual([
        expect.objectContaining({ id: LEGACY_SNAPSHOT_ID }),
      ])
      // The orphan snapshot has no entry attributing it to this Organization, so
      // it is declared as an excluded record class rather than guessed into the
      // archive.
      expect(entries.legacySnapshots.map(({ id }) => id)).not.toContain(
        ORPHAN_SNAPSHOT_ID,
      )
    })

    it('answers no_data for an Organization with no Recognition history', async () => {
      expect(
        await createLeaderboardOrganizationExportContributor(db).contribute({
          organizationId: EMPTY_ORGANIZATION_ID,
          requestId: randomUUID(),
          asOf: new Date(Date.now() - 1000),
        }),
      ).toEqual({
        context: 'leaderboard',
        coverage: 'no_data',
        omissionCodes: [],
        entries: [],
      })
    })

    it('is accepted by the Organization Export bundle builder', async () => {
      const contributor = createLeaderboardOrganizationExportContributor(db)
      const bundle = await buildOrganizationExportBundle({
        organizationId: ORGANIZATION_ID,
        requestId: randomUUID(),
        asOf: new Date(Date.now() - 1000),
        contributors: ORGANIZATION_LIFECYCLE_CONTEXTS.map((context) =>
          context === 'leaderboard'
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
          'leaderboard/recognition-activations.csv',
          'leaderboard/entries.json',
          'manifest.json',
        ]),
      )
    })

    it('contributing does not enable any Leaderboard capability', async () => {
      await createLeaderboardOrganizationExportContributor(db).contribute({
        organizationId: ORGANIZATION_ID,
        requestId: randomUUID(),
        asOf: new Date(Date.now() - 1000),
      })
      const context = buildLeaderboardContext()

      expect(Object.keys(context.publicApi)).toEqual([])
      expect(Object.keys(context.internal.repos)).toEqual([])
      expect(Object.keys(context.internal.useCases)).toEqual([])
    })
  },
)
