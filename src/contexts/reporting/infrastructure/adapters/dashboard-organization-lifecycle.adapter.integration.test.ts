// LIF-01-T12/T13/T14 — Dashboard lifecycle contributor against real PostgreSQL.
//
// The unit test proves the decision logic. Only a real schema can prove the
// three properties an operator relies on: Closing deletes nothing, readiness
// mutates nothing, and purge removes this tenant's milestones and no other
// tenant's row — with one append-only content-free receipt per phase.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createDashboardOrganizationLifecycleAdapter } from './dashboard-organization-lifecycle.adapter'

const organizations = new Set<string>()
let lease: TestLease
let db: Database

const REQUESTED_AT = new Date('2026-08-01T00:00:00.000Z')
const RECOVERABLE_UNTIL = new Date('2026-08-31T00:00:00.000Z')
const OCCURRED_AT = new Date('2026-09-01T00:00:00.000Z')

type Fixture = Readonly<{
  organizationId: string
  closureLineageId: string
}>

async function seedOrganization(prefix: string): Promise<string> {
  const organizationId = `${prefix}-${randomUUID()}`
  organizations.add(organizationId)
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Dashboard Lifecycle Fixture', $1, $2)`,
    [organizationId, REQUESTED_AT],
  )
  return organizationId
}

/** Walks the live authority to `closure_requested` (revision 1). */
async function requestClosure(fixture: Fixture): Promise<void> {
  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
     SET state = 'closure_requested', revision = revision + 1,
         closure_lineage_id = $2, closure_requested_at = $3,
         recoverable_until = $4, reactivation_required = true,
         requested_by = 'admin:dashboard-lifecycle-test',
         request_reason_code = 'test_workspace',
         request_support_evidence_ref = 'test:closure-request',
         last_transition_at = $3, last_actor_id = 'admin:dashboard-lifecycle-test',
         last_reason_code = 'test_workspace',
         last_support_evidence_ref = 'test:closure-request'
     WHERE organization_id = $1`,
    [fixture.organizationId, fixture.closureLineageId, REQUESTED_AT, RECOVERABLE_UNTIL],
  )
}

/** One further declared edge; the DB trigger rejects any other move. */
async function advance(
  organizationId: string,
  to: 'closing' | 'purge_pending' | 'purging',
  reasonCode: string,
): Promise<void> {
  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
     SET state = $2, revision = revision + 1,
         irreversible_at = CASE WHEN $2 = 'purging' THEN $3 ELSE irreversible_at END,
         last_transition_at = $3, last_actor_id = 'system:dashboard-lifecycle-test',
         last_reason_code = $4, last_support_evidence_ref = 'test:advance'
     WHERE organization_id = $1`,
    [organizationId, to, REQUESTED_AT, reasonCode],
  )
}

async function seedMilestones(organizationId: string): Promise<void> {
  for (const step of ['google_connection', 'published_portal']) {
    await lease.pool.query(
      `INSERT INTO setup_checklist_milestones
         (organization_id, step, first_completed_at, created_at)
       VALUES ($1, $2, $3, $3)`,
      [organizationId, step, REQUESTED_AT],
    )
  }
}

async function milestoneCount(organizationId: string): Promise<number> {
  const result = await lease.pool.query(
    'SELECT count(*)::int AS count FROM setup_checklist_milestones WHERE organization_id = $1',
    [organizationId],
  )
  return (result.rows[0] as { count: number }).count
}

async function receipts(organizationId: string) {
  const result = await lease.pool.query(
    `SELECT phase, payload->>'outcome' AS outcome,
            payload->>'evidenceRef' AS evidence_ref
     FROM organization_lifecycle_events
     WHERE organization_id = $1 AND context = 'dashboard'
       AND kind LIKE 'organization_lifecycle_contribution:%'
     ORDER BY phase`,
    [organizationId],
  )
  return result.rows as ReadonlyArray<{
    phase: string
    outcome: string
    evidence_ref: string
  }>
}

async function deleteReceiptFixtures(organizationIds: readonly string[]): Promise<void> {
  if (organizationIds.length === 0) return
  const client = await lease.pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `ALTER TABLE organization_lifecycle_events
       DISABLE TRIGGER organization_lifecycle_events_append_only`,
    )
    await client.query(
      `DELETE FROM organization_lifecycle_events
       WHERE organization_id = ANY($1::text[])`,
      [organizationIds],
    )
    await client.query(
      `ALTER TABLE organization_lifecycle_events
       ENABLE ALWAYS TRIGGER organization_lifecycle_events_append_only`,
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

describe.sequential('dashboard Organization lifecycle contributor', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 3)
    db = drizzle(lease.pool) as Database
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    for (const organizationId of organizations) {
      await lease.pool.query(
        'DELETE FROM setup_checklist_milestones WHERE organization_id = $1',
        [organizationId],
      )
    }
    await deleteReceiptFixtures([...organizations])
    await deleteTestOrganizations(lease.pool, [...organizations])
    organizations.clear()
  })

  it('prepareClosing keeps every milestone and records one content-free receipt', async () => {
    const fixture: Fixture = {
      organizationId: await seedOrganization('dashboard-lifecycle-org'),
      closureLineageId: randomUUID(),
    }
    await seedMilestones(fixture.organizationId)
    await requestClosure(fixture)

    const contributor = createDashboardOrganizationLifecycleAdapter(db)
    const result = await contributor.prepareClosing(contribution(fixture, 1))

    expect(result.outcome).toBe('complete')
    // Closing opens a recoverable window: nothing may be deleted here.
    expect(await milestoneCount(fixture.organizationId)).toBe(2)
    expect(await receipts(fixture.organizationId)).toEqual([
      {
        phase: 'closing',
        outcome: 'complete',
        evidence_ref: 'dashboard:closing:v1:read_surface_no_effects:2',
      },
    ])
  })

  it('verifyPurgeReadiness mutates nothing', async () => {
    const fixture: Fixture = {
      organizationId: await seedOrganization('dashboard-lifecycle-org'),
      closureLineageId: randomUUID(),
    }
    await seedMilestones(fixture.organizationId)
    await requestClosure(fixture)
    await advance(fixture.organizationId, 'closing', 'closing_prepared')

    const before = await lease.pool.query(
      `SELECT organization_id, step, first_completed_at, created_at
       FROM setup_checklist_milestones
       WHERE organization_id = $1 ORDER BY step`,
      [fixture.organizationId],
    )
    const contributor = createDashboardOrganizationLifecycleAdapter(db)
    const result = await contributor.verifyPurgeReadiness(contribution(fixture, 2))
    const after = await lease.pool.query(
      `SELECT organization_id, step, first_completed_at, created_at
       FROM setup_checklist_milestones
       WHERE organization_id = $1 ORDER BY step`,
      [fixture.organizationId],
    )

    expect(result.outcome).toBe('complete')
    expect(after.rows).toEqual(before.rows)
  })

  it('purge removes this tenant only, is idempotent, and leaves content-free evidence', async () => {
    const fixture: Fixture = {
      organizationId: await seedOrganization('dashboard-lifecycle-org'),
      closureLineageId: randomUUID(),
    }
    const bystanderId = await seedOrganization('dashboard-lifecycle-bystander')
    await seedMilestones(fixture.organizationId)
    await seedMilestones(bystanderId)
    await requestClosure(fixture)
    await advance(fixture.organizationId, 'closing', 'closing_prepared')
    await advance(fixture.organizationId, 'purge_pending', 'recovery_window_elapsed')
    await advance(fixture.organizationId, 'purging', 'irreversible_purge_authorized')

    const contributor = createDashboardOrganizationLifecycleAdapter(db)
    const first = await contributor.purge(contribution(fixture, 4))
    const replay = await contributor.purge(contribution(fixture, 4))

    expect(first.outcome).toBe('complete')
    expect(replay).toEqual(first)
    expect(await milestoneCount(fixture.organizationId)).toBe(0)
    // No tenant-cross deletion.
    expect(await milestoneCount(bystanderId)).toBe(2)
    // The replay returned the persisted receipt rather than writing a second.
    expect(await receipts(fixture.organizationId)).toEqual([
      {
        phase: 'purge',
        outcome: 'complete',
        evidence_ref: 'dashboard:purge:v1:milestones_deleted:2',
      },
    ])
  })

  it('answers no_data — never an omission — for an Organization with no milestone', async () => {
    const fixture: Fixture = {
      organizationId: await seedOrganization('dashboard-lifecycle-empty'),
      closureLineageId: randomUUID(),
    }
    await requestClosure(fixture)
    const contributor = createDashboardOrganizationLifecycleAdapter(db)

    await expect(contributor.prepareClosing(contribution(fixture, 1))).resolves.toEqual({
      outcome: 'no_data',
      evidenceRef: 'dashboard:closing:v1:read_surface_no_effects:0',
    })
    await advance(fixture.organizationId, 'closing', 'closing_prepared')
    await expect(
      contributor.verifyPurgeReadiness(contribution(fixture, 2)),
    ).resolves.toEqual({
      outcome: 'no_data',
      evidenceRef: 'dashboard:purge_readiness:v1:no_blocking_dependency:0',
    })
    await advance(fixture.organizationId, 'purge_pending', 'recovery_window_elapsed')
    await advance(fixture.organizationId, 'purging', 'irreversible_purge_authorized')
    await expect(contributor.purge(contribution(fixture, 4))).resolves.toEqual({
      outcome: 'no_data',
      evidenceRef: 'dashboard:purge:v1:nothing_to_scrub:0',
    })

    expect((await receipts(fixture.organizationId)).map((row) => row.outcome)).toEqual([
      'no_data',
      'no_data',
      'no_data',
    ])
  })

  it('refuses to contribute when the live authority is not in this phase', async () => {
    const fixture: Fixture = {
      organizationId: await seedOrganization('dashboard-lifecycle-stale'),
      closureLineageId: randomUUID(),
    }
    await seedMilestones(fixture.organizationId)
    await requestClosure(fixture)
    const contributor = createDashboardOrganizationLifecycleAdapter(db)

    // The authority still says `closure_requested`; purge is not the work to do.
    await expect(contributor.purge(contribution(fixture, 1))).rejects.toThrow(
      /authority changed/u,
    )
    expect(await milestoneCount(fixture.organizationId)).toBe(2)
    expect(await receipts(fixture.organizationId)).toEqual([])
  })
})
