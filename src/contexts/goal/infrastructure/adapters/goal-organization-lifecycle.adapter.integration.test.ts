// LIF-01-T12/T13/T14 — Goal lifecycle contributor against real PostgreSQL.
//
// The unit test proves the decision logic. Only a real schema can prove what
// an operator relies on: the Closing fence really is accepted by the
// `goal_programs_transition_guard` trigger and deletes nothing, readiness
// mutates nothing and fails closed on live work, and purge gets past the
// append-only guards, restores every one of them, empties this tenant and
// leaves every other tenant byte-identical.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  createGoalOrganizationLifecycleAdapter,
  GOAL_PURGE_TABLES,
} from './goal-organization-lifecycle.adapter'

// Immutable registry id seeded by migration 0018; `goal_program_versions`
// pins `portal_rating_count` to exactly this governed version.
const RATING_COUNT_GOAL_VERSION = '11111111-1111-4111-8111-111111111302'

/** The append-only guards the fixtures have to step around, exactly as purge does. */
const APPEND_ONLY_GUARDS = [
  ['goal_program_versions', 'goal_program_versions_append_only'],
  ['goal_result_revisions', 'goal_result_revisions_append_only'],
  ['goal_monthly_results', 'goal_monthly_results_guard'],
] as const

const organizations = new Set<string>()
let lease: TestLease
let db: Database

const REQUESTED_AT = new Date('2026-08-10T00:00:00.000Z')
const RECOVERABLE_UNTIL = new Date('2026-08-31T00:00:00.000Z')
const OCCURRED_AT = new Date('2026-09-01T00:00:00.000Z')
const VERSION_FROM = new Date('2026-06-01T00:00:00.000Z')
const PERIOD_START = new Date('2026-07-01T00:00:00.000Z')
const PERIOD_END = new Date('2026-08-01T00:00:00.000Z')
const CLOSED_AT = new Date('2026-08-02T00:00:00.000Z')

type Fixture = Readonly<{
  organizationId: string
  closureLineageId: string
  propertyId: string
  programId: string
}>

async function seedOrganization(prefix: string): Promise<string> {
  const organizationId = `${prefix}-${randomUUID()}`
  organizations.add(organizationId)
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Goal Lifecycle Fixture', $1, $2)`,
    [organizationId, REQUESTED_AT],
  )
  return organizationId
}

/** Seeds one row in every surviving Goal-owned table. */
async function seedTenantRows(
  prefix: string,
  programStatus: 'active' | 'paused' = 'active',
): Promise<Fixture> {
  const organizationId = await seedOrganization(prefix)
  const fixture: Fixture = {
    organizationId,
    closureLineageId: randomUUID(),
    propertyId: randomUUID(),
    programId: randomUUID(),
  }
  const programVersionId = randomUUID()
  const assignmentId = randomUUID()
  const monthlyResultId = randomUUID()
  const firstRevisionId = randomUUID()
  const secondRevisionId = randomUUID()

  await lease.pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1::uuid, $2, 'Goal Lifecycle Property', $1::text, 'UTC', $3, $3)`,
    [fixture.propertyId, organizationId, VERSION_FROM],
  )

  // ── Canonical Goal Program family ────────────────────────────────────
  await lease.pool.query(
    `INSERT INTO goal_programs
       (id, organization_id, property_id, name, status, current_version, created_by,
        created_at, updated_at)
     VALUES ($1::uuid, $2, $3::uuid, 'Lifecycle Program', $4, 1, 'user:test', $5, $5)`,
    [fixture.programId, organizationId, fixture.propertyId, programStatus, VERSION_FROM],
  )
  await lease.pool.query(
    `INSERT INTO goal_program_versions
       (id, program_id, organization_id, property_id, version, metric_definition_id,
        metric_definition_version_id, metric_key, metric_minimum_sample, target_value,
        property_timezone, effective_from, change_reason, created_by, created_at)
     VALUES ($1::uuid, $2::uuid, $3, $4::uuid, 1,
             (SELECT definition_id FROM metric_definition_versions WHERE id = $5::uuid),
             $5::uuid, 'portal_rating_count', 0, 10, 'UTC', $6, 'fixture', 'user:test', $6)`,
    [
      programVersionId,
      fixture.programId,
      organizationId,
      fixture.propertyId,
      RATING_COUNT_GOAL_VERSION,
      VERSION_FROM,
    ],
  )
  await lease.pool.query(
    `INSERT INTO goal_subject_assignments
       (id, program_id, program_version_id, organization_id, property_id, metric_key,
        subject_kind, property_subject_id, effective_from, created_by, created_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, 'portal_rating_count',
             'property', $5::uuid, $6, 'user:test', $6)`,
    [
      assignmentId,
      fixture.programId,
      programVersionId,
      organizationId,
      fixture.propertyId,
      VERSION_FROM,
    ],
  )
  await lease.pool.query(
    `INSERT INTO goal_monthly_results
       (id, assignment_id, program_id, program_version_id, organization_id, property_id,
        period_start, period_end, property_timezone, status, evaluation_state,
        sample_count, evaluation_watermark, closed_at, created_at, updated_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::uuid, $7, $8, 'UTC',
             'closed', 'unavailable', 0, $9, $9, $9, $9)`,
    [
      monthlyResultId,
      assignmentId,
      fixture.programId,
      programVersionId,
      organizationId,
      fixture.propertyId,
      PERIOD_START,
      PERIOD_END,
      CLOSED_AT,
    ],
  )
  // A two-link revision lineage: `supersedes_revision_id` is ON DELETE
  // RESTRICT, so a flat DELETE would be refused and purge has to drain it.
  await lease.pool.query(
    `INSERT INTO goal_result_revisions
       (id, monthly_result_id, organization_id, property_id, revision, evaluation_state,
        sample_count, evaluation_watermark, change_reason, created_by, created_at)
     VALUES ($1::uuid, $2::uuid, $3, $4::uuid, 1, 'unavailable', 0, $5, 'fixture',
             'user:test', $5)`,
    [firstRevisionId, monthlyResultId, organizationId, fixture.propertyId, CLOSED_AT],
  )
  await lease.pool.query(
    `INSERT INTO goal_result_revisions
       (id, monthly_result_id, organization_id, property_id, revision, evaluation_state,
        sample_count, evaluation_watermark, supersedes_revision_id, change_reason,
        created_by, created_at)
     VALUES ($1::uuid, $2::uuid, $3, $4::uuid, 2, 'unavailable', 0, $5, $6::uuid,
             'fixture', 'user:test', $5)`,
    [
      secondRevisionId,
      monthlyResultId,
      organizationId,
      fixture.propertyId,
      CLOSED_AT,
      firstRevisionId,
    ],
  )

  return fixture
}

async function requestClosure(fixture: Fixture): Promise<void> {
  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
     SET state = 'closure_requested', revision = revision + 1,
         closure_lineage_id = $2, closure_requested_at = $3,
         recoverable_until = $4, reactivation_required = true,
         requested_by = 'admin:goal-lifecycle-test',
         request_reason_code = 'test_workspace',
         request_support_evidence_ref = 'test:closure-request',
         last_transition_at = $3, last_actor_id = 'admin:goal-lifecycle-test',
         last_reason_code = 'test_workspace',
         last_support_evidence_ref = 'test:closure-request'
     WHERE organization_id = $1`,
    [fixture.organizationId, fixture.closureLineageId, REQUESTED_AT, RECOVERABLE_UNTIL],
  )
}

async function advance(
  organizationId: string,
  to: 'closing' | 'purge_pending' | 'purging',
  reasonCode: string,
): Promise<void> {
  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
     SET state = $2, revision = revision + 1,
         irreversible_at = CASE WHEN $2 = 'purging' THEN $3 ELSE irreversible_at END,
         last_transition_at = $3, last_actor_id = 'system:goal-lifecycle-test',
         last_reason_code = $4, last_support_evidence_ref = 'test:advance'
     WHERE organization_id = $1`,
    [organizationId, to, REQUESTED_AT, reasonCode],
  )
}

async function tableCounts(
  organizationId: string,
): Promise<Readonly<Record<string, number>>> {
  const counts: Record<string, number> = {}
  for (const table of GOAL_PURGE_TABLES) {
    const result = await lease.pool.query(
      `SELECT count(*)::int AS count FROM ${table} WHERE organization_id = $1`,
      [organizationId],
    )
    counts[table] = (result.rows[0] as { count: number }).count
  }
  return counts
}

async function programStatuses(
  organizationId: string,
): Promise<ReadonlyArray<{ status: string; status_reason: string | null }>> {
  const result = await lease.pool.query(
    `SELECT status, status_reason FROM goal_programs
     WHERE organization_id = $1 ORDER BY id`,
    [organizationId],
  )
  return result.rows as ReadonlyArray<{ status: string; status_reason: string | null }>
}

async function receipts(organizationId: string) {
  const result = await lease.pool.query(
    `SELECT phase, outcome, evidence_ref
     FROM context_organization_lifecycle_receipts
     WHERE organization_id = $1 AND context = 'goal'
     ORDER BY phase`,
    [organizationId],
  )
  return result.rows as ReadonlyArray<{
    phase: string
    outcome: string
    evidence_ref: string
  }>
}

async function deleteFixtures(organizationIds: readonly string[]): Promise<void> {
  if (organizationIds.length === 0) return
  const client = await lease.pool.connect()
  try {
    await client.query('BEGIN')
    for (const [table, trigger] of APPEND_ONLY_GUARDS) {
      await client.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`)
    }
    await client.query(
      `ALTER TABLE context_organization_lifecycle_receipts
       DISABLE TRIGGER context_organization_lifecycle_receipts_update_delete_guard`,
    )
    await client.query(
      `DELETE FROM goal_result_revisions
       WHERE organization_id = ANY($1::text[]) AND supersedes_revision_id IS NOT NULL`,
      [organizationIds],
    )
    for (const table of GOAL_PURGE_TABLES) {
      await client.query(`DELETE FROM ${table} WHERE organization_id = ANY($1::text[])`, [
        organizationIds,
      ])
    }
    await client.query(
      `DELETE FROM context_organization_lifecycle_receipts
       WHERE organization_id = ANY($1::text[])`,
      [organizationIds],
    )
    await client.query(`DELETE FROM properties WHERE organization_id = ANY($1::text[])`, [
      organizationIds,
    ])
    for (const [table, trigger] of APPEND_ONLY_GUARDS) {
      await client.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`)
    }
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

function contribution(fixture: Fixture, revision: number) {
  return {
    organizationId: fixture.organizationId,
    closureLineageId: fixture.closureLineageId,
    lifecycleRevision: revision,
    recoverableUntil: RECOVERABLE_UNTIL,
    occurredAt: OCCURRED_AT,
  }
}

describe.sequential('goal Organization lifecycle contributor', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 3)
    db = drizzle(lease.pool) as Database
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    await deleteFixtures([...organizations])
    await deleteTestOrganizations(lease.pool, [...organizations])
    organizations.clear()
  })

  it('prepareClosing pauses the active program and deletes nothing', async () => {
    const fixture = await seedTenantRows('goal-lifecycle-org')
    await requestClosure(fixture)
    const before = await tableCounts(fixture.organizationId)

    const contributor = createGoalOrganizationLifecycleAdapter(db)
    const result = await contributor.prepareClosing(contribution(fixture, 1))

    expect(result.outcome).toBe('complete')
    // The DB transition guard accepted `active -> paused`.
    expect(await programStatuses(fixture.organizationId)).toEqual([
      { status: 'paused', status_reason: 'organization_closure_fence' },
    ])
    // Closing opens a recoverable window: every row survives it.
    expect(await tableCounts(fixture.organizationId)).toEqual(before)
    const persisted = await receipts(fixture.organizationId)
    expect(persisted).toHaveLength(1)
    expect(persisted[0]!.phase).toBe('closing')
    expect(persisted[0]!.evidence_ref).toMatch(
      /^goal:closing:v1:programs_fenced:paused:1:rows:\d+$/u,
    )
    expect(persisted[0]!.evidence_ref).not.toContain(fixture.organizationId)
  })

  it('the Closing fence is reversible — paused -> active is still a legal edge', async () => {
    const fixture = await seedTenantRows('goal-lifecycle-org')
    await requestClosure(fixture)
    await createGoalOrganizationLifecycleAdapter(db).prepareClosing(
      contribution(fixture, 1),
    )

    await expect(
      lease.pool.query(
        `UPDATE goal_programs SET status = 'active', status_reason = 'reactivated'
         WHERE organization_id = $1`,
        [fixture.organizationId],
      ),
    ).resolves.toBeDefined()
    expect(await programStatuses(fixture.organizationId)).toEqual([
      { status: 'active', status_reason: 'reactivated' },
    ])
  })

  it('verifyPurgeReadiness mutates nothing once the fence is in place', async () => {
    const fixture = await seedTenantRows('goal-lifecycle-org', 'paused')
    await requestClosure(fixture)
    await advance(fixture.organizationId, 'closing', 'closing_prepared')
    const before = await tableCounts(fixture.organizationId)
    const programsBefore = await lease.pool.query(
      'SELECT * FROM goal_programs WHERE organization_id = $1 ORDER BY id',
      [fixture.organizationId],
    )

    const contributor = createGoalOrganizationLifecycleAdapter(db)
    const result = await contributor.verifyPurgeReadiness(contribution(fixture, 2))

    expect(result.outcome).toBe('complete')
    expect(await tableCounts(fixture.organizationId)).toEqual(before)
    const programsAfter = await lease.pool.query(
      'SELECT * FROM goal_programs WHERE organization_id = $1 ORDER BY id',
      [fixture.organizationId],
    )
    expect(programsAfter.rows).toEqual(programsBefore.rows)
  })

  it('verifyPurgeReadiness fails closed while a Goal Program is still active', async () => {
    const fixture = await seedTenantRows('goal-lifecycle-org')
    await requestClosure(fixture)
    await advance(fixture.organizationId, 'closing', 'closing_prepared')
    const before = await tableCounts(fixture.organizationId)

    const contributor = createGoalOrganizationLifecycleAdapter(db)
    await expect(
      contributor.verifyPurgeReadiness(contribution(fixture, 2)),
    ).rejects.toThrow(/readiness blocked/u)

    // A blocked answer stops the coordinator without a receipt or a mutation.
    expect(await receipts(fixture.organizationId)).toEqual([])
    expect(await tableCounts(fixture.organizationId)).toEqual(before)
  })

  it('purge empties this tenant only, is idempotent, and restores every guard', async () => {
    const fixture = await seedTenantRows('goal-lifecycle-org', 'paused')
    const bystander = await seedTenantRows('goal-lifecycle-bystander', 'paused')
    await requestClosure(fixture)
    await advance(fixture.organizationId, 'closing', 'closing_prepared')
    await advance(fixture.organizationId, 'purge_pending', 'recovery_window_elapsed')
    await advance(fixture.organizationId, 'purging', 'irreversible_purge_authorized')
    const bystanderBefore = await tableCounts(bystander.organizationId)

    const contributor = createGoalOrganizationLifecycleAdapter(db)
    const first = await contributor.purge(contribution(fixture, 4))
    const replay = await contributor.purge(contribution(fixture, 4))

    expect(first.outcome).toBe('complete')
    expect(replay).toEqual(first)

    const after = await tableCounts(fixture.organizationId)
    for (const table of GOAL_PURGE_TABLES) {
      expect({ table, count: after[table] }).toEqual({ table, count: 0 })
    }
    // No tenant-cross deletion.
    expect(await tableCounts(bystander.organizationId)).toEqual(bystanderBefore)

    // The append-only guards are back on: product code still cannot rewrite
    // another tenant's Goal history.
    await expect(
      lease.pool.query(
        `UPDATE goal_result_revisions SET change_reason = 'tampered'
         WHERE organization_id = $1`,
        [bystander.organizationId],
      ),
    ).rejects.toThrow(/append-only/u)
    await expect(
      lease.pool.query('DELETE FROM goal_monthly_results WHERE organization_id = $1', [
        bystander.organizationId,
      ]),
    ).rejects.toThrow(/cannot be deleted/u)

    const persisted = await receipts(fixture.organizationId)
    expect(persisted).toHaveLength(1)
    expect(persisted[0]!.phase).toBe('purge')
    expect(persisted[0]!.evidence_ref).toMatch(
      /^goal:purge:v1:tenant_rows_deleted:rows:\d+$/u,
    )
  })

  it('answers no_data — never an omission — for an Organization with no goal', async () => {
    const fixture: Fixture = {
      organizationId: await seedOrganization('goal-lifecycle-empty'),
      closureLineageId: randomUUID(),
      propertyId: randomUUID(),
      programId: randomUUID(),
    }
    await requestClosure(fixture)
    const contributor = createGoalOrganizationLifecycleAdapter(db)

    await expect(contributor.prepareClosing(contribution(fixture, 1))).resolves.toEqual({
      outcome: 'no_data',
      evidenceRef: 'goal:closing:v1:programs_fenced:paused:0:rows:0',
    })
    await advance(fixture.organizationId, 'closing', 'closing_prepared')
    await expect(
      contributor.verifyPurgeReadiness(contribution(fixture, 2)),
    ).resolves.toEqual({
      outcome: 'no_data',
      evidenceRef: 'goal:purge_readiness:v1:no_live_goal_work:rows:0',
    })
    await advance(fixture.organizationId, 'purge_pending', 'recovery_window_elapsed')
    await advance(fixture.organizationId, 'purging', 'irreversible_purge_authorized')
    await expect(contributor.purge(contribution(fixture, 4))).resolves.toEqual({
      outcome: 'no_data',
      evidenceRef: 'goal:purge:v1:nothing_to_scrub:rows:0',
    })

    expect((await receipts(fixture.organizationId)).map((row) => row.outcome)).toEqual([
      'no_data',
      'no_data',
      'no_data',
    ])
  })

  it('refuses to contribute when the live authority is not in this phase', async () => {
    const fixture = await seedTenantRows('goal-lifecycle-stale', 'paused')
    await requestClosure(fixture)
    const before = await tableCounts(fixture.organizationId)

    const contributor = createGoalOrganizationLifecycleAdapter(db)
    await expect(contributor.purge(contribution(fixture, 1))).rejects.toThrow(
      /authority changed/u,
    )

    expect(await tableCounts(fixture.organizationId)).toEqual(before)
    expect(await receipts(fixture.organizationId)).toEqual([])
  })
})
