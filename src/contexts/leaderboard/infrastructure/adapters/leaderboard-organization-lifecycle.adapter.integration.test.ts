// LIF-01-T12/T13/T14 — Leaderboard lifecycle contribution against real PostgreSQL.
//
// What only a real schema can prove here:
//   * Closing and purge readiness leave every retained board row and every
//     append-only guard exactly as they were.
//   * `leaderboard_snapshots` — which has no `organization_id` at all — is
//     genuinely bound to this tenant and only this tenant.
//   * The purge removes governed board facts past their `BEFORE DELETE`
//     append-only triggers (migration 0025), restoring them in the same commit.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { buildLeaderboardContext } from '../../build'
import {
  createLeaderboardOrganizationLifecycleContributor,
  LEADERBOARD_LIFECYCLE_APPEND_ONLY_GUARDS,
  LEADERBOARD_LIFECYCLE_TABLES,
} from './leaderboard-organization-lifecycle.adapter'

let lease: TestLease
let db: Database

const suffix = randomUUID()
const ORGANIZATION_ID = `lb-lifecycle-org-${suffix}`
const OTHER_ORGANIZATION_ID = `lb-lifecycle-other-${suffix}`
const EMPTY_ORGANIZATION_ID = `lb-lifecycle-empty-${suffix}`
const ORGANIZATION_IDS = [
  ORGANIZATION_ID,
  OTHER_ORGANIZATION_ID,
  EMPTY_ORGANIZATION_ID,
] as const

const REQUESTED_AT = new Date('2026-08-01T00:00:00.000Z')
const RECOVERABLE_UNTIL = new Date('2026-08-31T00:00:00.000Z')
const PERIOD_START = '2026-07-01T00:00:00.000Z'
const PERIOD_END = '2026-08-01T00:00:00.000Z'

const lineage = new Map<string, string>()
const legacySnapshotOf = new Map<string, string>()

let metricDefinitionId = ''
let metricDefinitionVersionId = ''

const TEARDOWN_APPEND_ONLY = [
  {
    table: 'recognition_board_entries',
    trigger: 'recognition_board_entries_append_only',
  },
  {
    table: 'recognition_board_snapshots',
    trigger: 'recognition_board_snapshots_append_only',
  },
  {
    table: 'recognition_reconciliation_events',
    trigger: 'recognition_reconciliation_events_append_only',
  },
] as const

/**
 * `leaderboard_snapshots` has no tenant column, so its count is taken through
 * the same indirection the adapter uses.
 */
const countLegacySnapshots = async (organizationId: string): Promise<number> => {
  const result = await lease.pool.query<{ count: string }>(
    `SELECT count(*) AS count FROM leaderboard_snapshots s
     WHERE s.property_id IN (SELECT id FROM properties WHERE organization_id = $1)
        OR s.id IN (SELECT snapshot_id FROM leaderboard_entries WHERE organization_id = $1)`,
    [organizationId],
  )
  return Number(result.rows[0]?.count ?? '0')
}

const countRows = async (table: string, organizationId: string): Promise<number> => {
  if (table === 'leaderboard_snapshots') return countLegacySnapshots(organizationId)
  const result = await lease.pool.query<{ count: string }>(
    `SELECT count(*) AS count FROM ${table} WHERE organization_id = $1`,
    [organizationId],
  )
  return Number(result.rows[0]?.count ?? '0')
}

const boardRowCounts = async (
  organizationId: string,
): Promise<Record<string, number>> => {
  const entries = await Promise.all(
    LEADERBOARD_LIFECYCLE_TABLES.map(
      async (table) => [table, await countRows(table, organizationId)] as const,
    ),
  )
  return Object.fromEntries(entries)
}

const guardStates = async (): Promise<Record<string, string>> => {
  const result = await lease.pool.query<{ tgname: string; tgenabled: string }>(
    `SELECT t.tgname, t.tgenabled FROM pg_trigger t
     WHERE t.tgname = ANY($1::text[]) ORDER BY t.tgname`,
    [[...LEADERBOARD_LIFECYCLE_APPEND_ONLY_GUARDS]],
  )
  return Object.fromEntries(
    result.rows.map(({ tgname, tgenabled }) => [tgname, tgenabled]),
  )
}

const seedOrganization = async (organizationId: string): Promise<void> => {
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Leaderboard Lifecycle Fixture', $1, $2)`,
    [organizationId, REQUESTED_AT],
  )
  const closureLineageId = randomUUID()
  lineage.set(organizationId, closureLineageId)
  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
     SET state = 'closure_requested', revision = 1,
         closure_lineage_id = $2, closure_requested_at = $3,
         recoverable_until = $4, reactivation_required = true,
         requested_by = 'admin:lb-lifecycle-test',
         request_reason_code = 'test_workspace',
         request_support_evidence_ref = 'test:closure-request',
         last_transition_at = $3, last_actor_id = 'admin:lb-lifecycle-test',
         last_reason_code = 'test_workspace',
         last_support_evidence_ref = 'test:closure-request'
     WHERE organization_id = $1`,
    [organizationId, closureLineageId, REQUESTED_AT, RECOVERABLE_UNTIL],
  )
}

const advanceAuthority = async (
  organizationId: string,
  to: 'closing' | 'purge_pending' | 'purging',
  reasonCode: string,
  revision: number,
  at: Date,
): Promise<void> => {
  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
     SET state = $2, revision = $3, last_transition_at = $4,
         last_actor_id = 'system:lifecycle', last_reason_code = $5,
         last_support_evidence_ref = 'test:phase',
         irreversible_at = CASE WHEN $2 = 'purging' THEN $4 ELSE irreversible_at END
     WHERE organization_id = $1`,
    [organizationId, to, revision, at, reasonCode],
  )
}

const contribution = (organizationId: string, revision: number, occurredAt: Date) => ({
  organizationId,
  closureLineageId: lineage.get(organizationId)!,
  lifecycleRevision: revision,
  recoverableUntil: RECOVERABLE_UNTIL,
  occurredAt,
})

const receiptRows = async (organizationId: string) => {
  const result = await lease.pool.query<{
    phase: string
    outcome: string
    evidence_ref: string
  }>(
    `SELECT phase, outcome, evidence_ref
     FROM context_organization_lifecycle_receipts
     WHERE organization_id = $1 AND context = 'leaderboard'
     ORDER BY phase`,
    [organizationId],
  )
  return result.rows
}

const deleteReceipts = async (organizationIds: readonly string[]): Promise<void> => {
  const client = await lease.pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `ALTER TABLE context_organization_lifecycle_receipts
       DISABLE TRIGGER context_organization_lifecycle_receipts_update_delete_guard`,
    )
    await client.query(
      `DELETE FROM context_organization_lifecycle_receipts
       WHERE organization_id = ANY($1::text[])`,
      [organizationIds],
    )
    await client.query(
      `ALTER TABLE context_organization_lifecycle_receipts
       ENABLE ALWAYS TRIGGER context_organization_lifecycle_receipts_update_delete_guard`,
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const seedTenant = async (organizationId: string): Promise<void> => {
  const propertyId = randomUUID()
  const portalGroupId = randomUUID()
  const activationId = randomUUID()
  const boardSnapshotId = randomUUID()
  const legacySnapshotId = randomUUID()
  legacySnapshotOf.set(organizationId, legacySnapshotId)

  await lease.pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Leaderboard Lifecycle Property', $3, 'UTC')`,
    [propertyId, organizationId, `property-${propertyId}`],
  )
  await lease.pool.query(
    `INSERT INTO portal_groups
       (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, 'Front Desk', NOW(), NOW())`,
    [portalGroupId, organizationId, propertyId],
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
    [activationId, organizationId, propertyId, metricDefinitionVersionId, PERIOD_START],
  )
  await lease.pool.query(
    `INSERT INTO recognition_activation_groups
       (id, organization_id, property_id, activation_id, portal_group_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), organizationId, propertyId, activationId, portalGroupId],
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
      boardSnapshotId,
      organizationId,
      propertyId,
      activationId,
      metricDefinitionId,
      metricDefinitionVersionId,
      PERIOD_START,
      PERIOD_END,
    ],
  )
  await lease.pool.query(
    `INSERT INTO recognition_board_entries
       (id, organization_id, property_id, snapshot_id, portal_group_id, value,
        numerator, denominator, sample_count, exposure_count, completeness, rank,
        tie_group, eligibility_reason, status, source_watermark,
        correction_generation, employment_decision_eligible, reconciled_at)
     VALUES ($1, $2, $3, $4, $5, 0.5, 5, 10, 12, 30, 0.95000, 1, 1,
             'threshold_met', 'ranked', $6, 0, false, $6)`,
    [
      randomUUID(),
      organizationId,
      propertyId,
      boardSnapshotId,
      portalGroupId,
      PERIOD_END,
    ],
  )
  await lease.pool.query(
    `INSERT INTO recognition_reconciliation_events
       (id, organization_id, property_id, metric_definition_version_id,
        source_event_id, source_watermark, processed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [
      randomUUID(),
      organizationId,
      propertyId,
      metricDefinitionVersionId,
      `source-event-${organizationId}`,
      PERIOD_END,
    ],
  )
  await lease.pool.query(
    `INSERT INTO leaderboard_snapshots
       (id, property_id, period, scope, metric_key, score_key, last_updated_at)
     VALUES ($1, $2, 'monthly', 'property', 'rating_average', 'overall', $3)`,
    [legacySnapshotId, propertyId, PERIOD_END],
  )
  await lease.pool.query(
    `INSERT INTO leaderboard_entries
       (id, snapshot_id, rank, target_type, target_id, organization_id,
        property_id, score, metric_value, normalized_score, updated_at)
     VALUES ($1, $2, 1, 'property', $3, $4, $3, 0.9, 4.5, 0.9, $5)`,
    [randomUUID(), legacySnapshotId, propertyId, organizationId, PERIOD_END],
  )
}

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

  for (const organizationId of ORGANIZATION_IDS) await seedOrganization(organizationId)
  await seedTenant(ORGANIZATION_ID)
  await seedTenant(OTHER_ORGANIZATION_ID)
})

afterAll(async () => {
  const organizationIds = [...ORGANIZATION_IDS]
  const client = await lease.pool.connect()
  try {
    await client.query('BEGIN')
    for (const { table, trigger } of TEARDOWN_APPEND_ONLY) {
      await client.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`)
    }
    for (const table of [
      'leaderboard_entries',
      'recognition_reconciliation_events',
      'recognition_board_entries',
      'recognition_board_snapshots',
      'recognition_activation_groups',
      'recognition_activations',
      'portal_groups',
    ]) {
      await client.query(`DELETE FROM ${table} WHERE organization_id = ANY($1::text[])`, [
        organizationIds,
      ])
    }
    await client.query(
      `DELETE FROM leaderboard_snapshots
       WHERE property_id IN (
         SELECT id FROM properties WHERE organization_id = ANY($1::text[])
       )`,
      [organizationIds],
    )
    await client.query(`DELETE FROM properties WHERE organization_id = ANY($1::text[])`, [
      organizationIds,
    ])
    for (const { table, trigger } of TEARDOWN_APPEND_ONLY) {
      await client.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`)
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  await lease.pool.query(
    'DELETE FROM outbox_events WHERE organization_id = ANY($1::text[])',
    [organizationIds],
  )
  await deleteReceipts(organizationIds)
  await deleteTestOrganizations(lease.pool, organizationIds)
  await lease.release()
})

describe.sequential(
  'Leaderboard Organization lifecycle contributor (real PostgreSQL)',
  () => {
    it('answers Closing without deleting a row or touching an append-only guard', async () => {
      const contributor = createLeaderboardOrganizationLifecycleContributor(db)
      const before = await boardRowCounts(ORGANIZATION_ID)
      const guardsBefore = await guardStates()
      expect(before).toEqual({
        leaderboard_snapshots: 1,
        leaderboard_entries: 1,
        recognition_reconciliation_events: 1,
        recognition_board_entries: 1,
        recognition_board_snapshots: 1,
        recognition_activation_groups: 1,
        recognition_activations: 1,
      })

      await expect(
        contributor.prepareClosing(
          contribution(ORGANIZATION_ID, 1, new Date('2026-08-02T00:00:00.000Z')),
        ),
      ).resolves.toEqual({
        outcome: 'complete',
        evidenceRef: 'leaderboard:closing:complete:7',
      })

      expect(await boardRowCounts(ORGANIZATION_ID)).toEqual(before)
      expect(await guardStates()).toEqual(guardsBefore)
      expect(await receiptRows(ORGANIZATION_ID)).toEqual([
        {
          phase: 'closing',
          outcome: 'complete',
          evidence_ref: 'leaderboard:closing:complete:7',
        },
      ])
      expect(Object.keys(buildLeaderboardContext().publicApi)).toEqual([])
    })

    it('answers an Organization with no board rows with affirmative no_data', async () => {
      const contributor = createLeaderboardOrganizationLifecycleContributor(db)
      await expect(
        contributor.prepareClosing(
          contribution(EMPTY_ORGANIZATION_ID, 1, new Date('2026-08-02T00:00:00.000Z')),
        ),
      ).resolves.toEqual({
        outcome: 'no_data',
        evidenceRef: 'leaderboard:closing:no_data:0',
      })
    })

    it('fails purge readiness closed on an unpublished Recognition fact', async () => {
      await advanceAuthority(
        ORGANIZATION_ID,
        'closing',
        'closing_prepared',
        2,
        new Date('2026-08-03T00:00:00.000Z'),
      )
      const blockerId = randomUUID()
      await lease.pool.query(
        `INSERT INTO outbox_events
           (id, event_type, event_version, payload, organization_id,
            source_context, source_aggregate_id, created_at)
         VALUES ($1, 'recognition.board.reconciled', 1, '{}'::jsonb, $2,
                 'recognition', $3, $4)`,
        [blockerId, ORGANIZATION_ID, blockerId, REQUESTED_AT],
      )
      const contributor = createLeaderboardOrganizationLifecycleContributor(db)
      const before = await boardRowCounts(ORGANIZATION_ID)

      await expect(
        contributor.verifyPurgeReadiness(
          contribution(ORGANIZATION_ID, 2, new Date('2026-08-04T00:00:00.000Z')),
        ),
      ).rejects.toThrow('unpublished_recognition_outbox_events')

      expect(await boardRowCounts(ORGANIZATION_ID)).toEqual(before)
      expect((await receiptRows(ORGANIZATION_ID)).map(({ phase }) => phase)).toEqual([
        'closing',
      ])

      await lease.pool.query('UPDATE outbox_events SET published_at = $2 WHERE id = $1', [
        blockerId,
        REQUESTED_AT,
      ])
    })

    it('verifies purge readiness without mutating a row or a guard', async () => {
      const contributor = createLeaderboardOrganizationLifecycleContributor(db)
      const before = await boardRowCounts(ORGANIZATION_ID)
      const guardsBefore = await guardStates()

      await expect(
        contributor.verifyPurgeReadiness(
          contribution(ORGANIZATION_ID, 2, new Date('2026-08-04T01:00:00.000Z')),
        ),
      ).resolves.toEqual({
        outcome: 'complete',
        evidenceRef: 'leaderboard:purge_readiness:complete:7',
      })
      expect(await boardRowCounts(ORGANIZATION_ID)).toEqual(before)
      expect(await guardStates()).toEqual(guardsBefore)
    })

    it('purges governed board facts past their guards and leaves the other tenant intact', async () => {
      await advanceAuthority(
        ORGANIZATION_ID,
        'purge_pending',
        'recovery_window_elapsed',
        3,
        new Date('2026-09-01T00:00:00.000Z'),
      )
      await advanceAuthority(
        ORGANIZATION_ID,
        'purging',
        'irreversible_purge_authorized',
        4,
        new Date('2026-09-02T00:00:00.000Z'),
      )
      const guardsBefore = await guardStates()
      await expect(
        lease.pool.query(
          'DELETE FROM recognition_board_entries WHERE organization_id = $1',
          [ORGANIZATION_ID],
        ),
      ).rejects.toThrow(/append-only/u)

      const otherBefore = await boardRowCounts(OTHER_ORGANIZATION_ID)
      const contributor = createLeaderboardOrganizationLifecycleContributor(db)

      await expect(
        contributor.purge(
          contribution(ORGANIZATION_ID, 4, new Date('2026-09-03T00:00:00.000Z')),
        ),
        // Six, not seven: the seeded `leaderboard_entries` row is removed by
        // the cascade from its snapshot, so the snapshot statement counts it
        // and the explicit entries mop-up honestly reports zero.
      ).resolves.toEqual({
        outcome: 'complete',
        evidenceRef: 'leaderboard:purge:complete:6',
      })

      expect(await boardRowCounts(ORGANIZATION_ID)).toEqual(
        Object.fromEntries(LEADERBOARD_LIFECYCLE_TABLES.map((table) => [table, 0])),
      )
      // No tenant-cross deletion, including through the tenant-column-less
      // legacy snapshot indirection.
      expect(await boardRowCounts(OTHER_ORGANIZATION_ID)).toEqual(otherBefore)
      const otherSnapshot = await lease.pool.query<{ count: string }>(
        'SELECT count(*) AS count FROM leaderboard_snapshots WHERE id = $1',
        [legacySnapshotOf.get(OTHER_ORGANIZATION_ID)],
      )
      expect(Number(otherSnapshot.rows[0]!.count)).toBe(1)
      expect(await guardStates()).toEqual(guardsBefore)

      for (const table of LEADERBOARD_LIFECYCLE_TABLES) {
        const present = await lease.pool.query<{ count: string }>(
          `SELECT count(*) AS count FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = $1`,
          [table],
        )
        expect(Number(present.rows[0]!.count)).toBe(1)
      }
    })

    it('is idempotent: replaying the purge returns the recorded content-free receipt', async () => {
      const contributor = createLeaderboardOrganizationLifecycleContributor(db)
      await expect(
        contributor.purge(
          contribution(ORGANIZATION_ID, 4, new Date('2026-09-03T02:00:00.000Z')),
        ),
      ).resolves.toEqual({
        outcome: 'complete',
        evidenceRef: 'leaderboard:purge:complete:6',
      })

      const receipts = await receiptRows(ORGANIZATION_ID)
      expect(receipts.map(({ phase }) => phase)).toEqual([
        'closing',
        'purge',
        'purge_readiness',
      ])
      for (const receipt of receipts) {
        expect(receipt.evidence_ref).toMatch(/^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$/u)
        expect(receipt.evidence_ref).not.toContain('rating_average')
      }
    })
  },
)
