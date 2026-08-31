// LIF-01-T12/T13/T14 — Team lifecycle contribution against real PostgreSQL.
//
// Team is dark, so the interesting questions are not "does the feature stop"
// but "does a quarantined context still answer honestly, and does answering
// leave the quarantine and the data exactly where they were": Closing deletes
// nothing, readiness mutates nothing, and purge empties this tenant's rows
// without dropping the tables CNV-01 contraction still has to reconcile.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { buildTeamContext } from '../../build'
import {
  createTeamOrganizationLifecycleContributor,
  TEAM_LIFECYCLE_TABLES,
} from './team-organization-lifecycle.adapter'

let lease: TestLease
let db: Database

const suffix = randomUUID()
const ORGANIZATION_ID = `team-lifecycle-org-${suffix}`
const OTHER_ORGANIZATION_ID = `team-lifecycle-other-${suffix}`
const EMPTY_ORGANIZATION_ID = `team-lifecycle-empty-${suffix}`
const ORGANIZATION_IDS = [
  ORGANIZATION_ID,
  OTHER_ORGANIZATION_ID,
  EMPTY_ORGANIZATION_ID,
] as const

const REQUESTED_AT = new Date('2026-08-01T00:00:00.000Z')
const RECOVERABLE_UNTIL = new Date('2026-08-31T00:00:00.000Z')
const EFFECTIVE_FROM = '2026-01-01T00:00:00.000Z'

const lineage = new Map<string, string>()

const FIXTURE_TABLES = [
  'team_memberships',
  'team_portal_group_scopes',
  'teams',
  'portal_groups',
  'staff_participations',
  'staff_participants',
  'properties',
] as const

const countRows = async (table: string, organizationId: string): Promise<number> => {
  const result = await lease.pool.query<{ count: string }>(
    `SELECT count(*) AS count FROM ${table} WHERE organization_id = $1`,
    [organizationId],
  )
  return Number(result.rows[0]?.count ?? '0')
}

const teamRowCounts = async (organizationId: string): Promise<Record<string, number>> => {
  const entries = await Promise.all(
    TEAM_LIFECYCLE_TABLES.map(
      async (table) => [table, await countRows(table, organizationId)] as const,
    ),
  )
  return Object.fromEntries(entries)
}

const seedOrganization = async (organizationId: string): Promise<void> => {
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Team Lifecycle Fixture', $1, $2)`,
    [organizationId, REQUESTED_AT],
  )
  const closureLineageId = randomUUID()
  lineage.set(organizationId, closureLineageId)
  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
     SET state = 'closure_requested', revision = 1,
         closure_lineage_id = $2, closure_requested_at = $3,
         recoverable_until = $4, reactivation_required = true,
         requested_by = 'admin:team-lifecycle-test',
         request_reason_code = 'test_workspace',
         request_support_evidence_ref = 'test:closure-request',
         last_transition_at = $3, last_actor_id = 'admin:team-lifecycle-test',
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
     WHERE organization_id = $1 AND context = 'team'
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
  const participantId = randomUUID()
  const participationId = randomUUID()
  const teamId = randomUUID()

  await lease.pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Team Lifecycle Property', $3, 'UTC')`,
    [propertyId, organizationId, `property-${propertyId}`],
  )
  await lease.pool.query(
    `INSERT INTO portal_groups
       (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, 'Front Desk', NOW(), NOW())`,
    [portalGroupId, organizationId, propertyId],
  )
  await lease.pool.query(
    `INSERT INTO staff_participants
       (id, organization_id, display_name, status, created_by)
     VALUES ($1, $2, 'Dana Rivera', 'active', 'user-admin')`,
    [participantId, organizationId],
  )
  await lease.pool.query(
    `INSERT INTO staff_participations
       (id, organization_id, property_id, staff_participant_id, display_name,
        status, created_by)
     VALUES ($1, $2, $3, $4, 'Dana Rivera', 'active', 'user-admin')`,
    [participationId, organizationId, propertyId, participantId],
  )
  await lease.pool.query(
    `INSERT INTO teams (id, organization_id, property_id, name)
     VALUES ($1, $2, $3, 'Housekeeping')`,
    [teamId, organizationId, propertyId],
  )
  await lease.pool.query(
    `INSERT INTO team_memberships
       (id, organization_id, property_id, team_id, staff_participation_id, role,
        effective_from, created_by)
     VALUES ($1, $2, $3, $4, $5, 'member', $6, 'user-admin')`,
    [randomUUID(), organizationId, propertyId, teamId, participationId, EFFECTIVE_FROM],
  )
  await lease.pool.query(
    `INSERT INTO team_portal_group_scopes
       (id, organization_id, property_id, team_id, portal_group_id,
        effective_from, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'user-admin')`,
    [randomUUID(), organizationId, propertyId, teamId, portalGroupId, EFFECTIVE_FROM],
  )
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
  db = drizzle(lease.pool) as Database
  for (const organizationId of ORGANIZATION_IDS) await seedOrganization(organizationId)
  await seedTenant(ORGANIZATION_ID)
  await seedTenant(OTHER_ORGANIZATION_ID)
})

afterAll(async () => {
  const organizationIds = [...ORGANIZATION_IDS]
  for (const table of FIXTURE_TABLES) {
    await lease.pool.query(
      `DELETE FROM ${table} WHERE organization_id = ANY($1::text[])`,
      [organizationIds],
    )
  }
  await lease.pool.query(
    'DELETE FROM outbox_events WHERE organization_id = ANY($1::text[])',
    [organizationIds],
  )
  await deleteReceipts(organizationIds)
  await deleteTestOrganizations(lease.pool, organizationIds)
  await lease.release()
})

describe.sequential('Team Organization lifecycle contributor (real PostgreSQL)', () => {
  it('answers Closing without deleting a single quarantined row', async () => {
    const contributor = createTeamOrganizationLifecycleContributor(db)
    const before = await teamRowCounts(ORGANIZATION_ID)
    expect(before).toEqual({
      team_memberships: 1,
      team_portal_group_scopes: 1,
      teams: 1,
    })

    await expect(
      contributor.prepareClosing(
        contribution(ORGANIZATION_ID, 1, new Date('2026-08-02T00:00:00.000Z')),
      ),
    ).resolves.toEqual({ outcome: 'complete', evidenceRef: 'team:closing:complete:3' })

    expect(await teamRowCounts(ORGANIZATION_ID)).toEqual(before)
    expect(await receiptRows(ORGANIZATION_ID)).toEqual([
      {
        phase: 'closing',
        outcome: 'complete',
        evidence_ref: 'team:closing:complete:3',
      },
    ])
    // Answering the lifecycle must not light the capability back up.
    expect(Object.keys(buildTeamContext().publicApi)).toEqual([])
  })

  it('answers an Organization with no Team rows with affirmative no_data', async () => {
    const contributor = createTeamOrganizationLifecycleContributor(db)
    await expect(
      contributor.prepareClosing(
        contribution(EMPTY_ORGANIZATION_ID, 1, new Date('2026-08-02T00:00:00.000Z')),
      ),
    ).resolves.toEqual({ outcome: 'no_data', evidenceRef: 'team:closing:no_data:0' })
  })

  it('fails purge readiness closed on an unpublished Team fact, changing nothing', async () => {
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
       VALUES ($1, 'team.updated', 1, '{}'::jsonb, $2, 'team', $3, $4)`,
      [blockerId, ORGANIZATION_ID, blockerId, REQUESTED_AT],
    )
    const contributor = createTeamOrganizationLifecycleContributor(db)
    const before = await teamRowCounts(ORGANIZATION_ID)

    await expect(
      contributor.verifyPurgeReadiness(
        contribution(ORGANIZATION_ID, 2, new Date('2026-08-04T00:00:00.000Z')),
      ),
    ).rejects.toThrow('unpublished_team_outbox_events')

    expect(await teamRowCounts(ORGANIZATION_ID)).toEqual(before)
    expect((await receiptRows(ORGANIZATION_ID)).map(({ phase }) => phase)).toEqual([
      'closing',
    ])

    await lease.pool.query('UPDATE outbox_events SET published_at = $2 WHERE id = $1', [
      blockerId,
      REQUESTED_AT,
    ])
  })

  it('verifies purge readiness without mutating a single row', async () => {
    const contributor = createTeamOrganizationLifecycleContributor(db)
    const before = await teamRowCounts(ORGANIZATION_ID)

    await expect(
      contributor.verifyPurgeReadiness(
        contribution(ORGANIZATION_ID, 2, new Date('2026-08-04T01:00:00.000Z')),
      ),
    ).resolves.toEqual({
      outcome: 'complete',
      evidenceRef: 'team:purge_readiness:complete:3',
    })
    expect(await teamRowCounts(ORGANIZATION_ID)).toEqual(before)
  })

  it('purges this tenant only, releases the Staff link, and drops no table', async () => {
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

    // The documented ordering: while Team still holds a membership, Staff
    // physically cannot drop the participation it points at.
    await expect(
      lease.pool.query('DELETE FROM staff_participations WHERE organization_id = $1', [
        ORGANIZATION_ID,
      ]),
    ).rejects.toThrow(/violates foreign key constraint/u)

    const otherBefore = await teamRowCounts(OTHER_ORGANIZATION_ID)
    const contributor = createTeamOrganizationLifecycleContributor(db)

    await expect(
      contributor.purge(
        contribution(ORGANIZATION_ID, 4, new Date('2026-09-03T00:00:00.000Z')),
      ),
    ).resolves.toEqual({ outcome: 'complete', evidenceRef: 'team:purge:complete:3' })

    expect(await teamRowCounts(ORGANIZATION_ID)).toEqual({
      team_memberships: 0,
      team_portal_group_scopes: 0,
      teams: 0,
    })
    expect(await teamRowCounts(OTHER_ORGANIZATION_ID)).toEqual(otherBefore)

    // Staff's own purge can now proceed — Team released the reference.
    await expect(
      lease.pool.query('DELETE FROM staff_participations WHERE organization_id = $1', [
        ORGANIZATION_ID,
      ]),
    ).resolves.toBeDefined()

    for (const table of TEAM_LIFECYCLE_TABLES) {
      const present = await lease.pool.query<{ count: string }>(
        `SELECT count(*) AS count FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1`,
        [table],
      )
      expect(Number(present.rows[0]!.count)).toBe(1)
    }
  })

  it('is idempotent: replaying the purge returns the recorded content-free receipt', async () => {
    const contributor = createTeamOrganizationLifecycleContributor(db)
    await expect(
      contributor.purge(
        contribution(ORGANIZATION_ID, 4, new Date('2026-09-03T02:00:00.000Z')),
      ),
    ).resolves.toEqual({ outcome: 'complete', evidenceRef: 'team:purge:complete:3' })

    const receipts = await receiptRows(ORGANIZATION_ID)
    expect(receipts.map(({ phase }) => phase)).toEqual([
      'closing',
      'purge',
      'purge_readiness',
    ])
    for (const receipt of receipts) {
      expect(receipt.evidence_ref).toMatch(/^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$/u)
      expect(receipt.evidence_ref).not.toContain('Housekeeping')
    }
  })
})
