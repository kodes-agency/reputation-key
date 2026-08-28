// LIF-01 T12/T13/T14 — Activity's lifecycle contributor against real
// PostgreSQL.
//
// The unit test proves the decision layer. Only a real schema can prove the
// claims that decide whether evidence survives a closure:
//
//   * Closing mutates nothing at all — Activity has no effect of its own to
//     stop, and Closing must leave the projection intact for a cancellation.
//   * Readiness mutates nothing and FAILS CLOSED on an unreleased Operational
//     Action History legal hold, so a hold stops the irreversible boundary.
//   * Purge removes Recent Activity and its replay authority, and RETAINS
//     Operational Action History — which migration 0149 enforces structurally
//     by rejecting DELETE and TRUNCATE on those tables.
//   * Purge is tenant-scoped: a second Organization is byte-identical after.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createActivityOrganizationLifecycleContributor } from './activity-organization-lifecycle.adapter'

let lease: TestLease
let db: Database
const organizations = new Set<string>()

const REQUESTED_AT = new Date('2026-07-28T00:00:00.000Z')
const RECOVERABLE_UNTIL = new Date('2026-08-27T00:00:00.000Z')
const OCCURRED_AT = new Date('2026-08-28T00:00:00.000Z')

/** Recent Activity: tenant content, removed by Purge. */
const PROJECTION_TABLES = [
  'recent_activity_actor_label_redactions',
  'recent_activity_entries',
  'recent_activity_replay_facts',
] as const

/**
 * Independently retained evidence, deliberately NOT purged with the tenant.
 * `operational_action_history_*` is program bullet 5 evidence with append-only
 * database guards; `recent_activity_vocabulary_reconciliations` is the
 * content-minimal operator authorization receipt for a historical rewrite.
 */
const RETAINED_TABLES = [
  'operational_action_history_heads',
  'operational_action_history_legal_holds',
  'operational_action_history_records',
  'recent_activity_vocabulary_reconciliations',
] as const

const HISTORY_GUARD_TRIGGERS = [
  [
    'operational_action_history_records',
    'operational_action_history_records_mutation_guard',
  ],
  [
    'operational_action_history_legal_holds',
    'operational_action_history_legal_holds_mutation_guard',
  ],
  ['operational_action_history_heads', 'operational_action_history_heads_update_guard'],
] as const

type Fixture = Readonly<{
  organizationId: string
  closureLineageId: string
  actorSubjectId: string
  holdId: string
  historyRecordId: string
}>

type PhaseRequest = Readonly<{
  organizationId: string
  closureLineageId: string
  lifecycleRevision: number
  recoverableUntil: Date
  occurredAt: Date
}>

const requestFor = (fixture: Fixture, lifecycleRevision: number): PhaseRequest => ({
  organizationId: fixture.organizationId,
  closureLineageId: fixture.closureLineageId,
  lifecycleRevision,
  recoverableUntil: RECOVERABLE_UNTIL,
  occurredAt: OCCURRED_AT,
})

async function rowCounts(
  organizationId: string,
  tables: readonly string[],
): Promise<Readonly<Record<string, number>>> {
  const counts: Record<string, number> = {}
  for (const table of tables) {
    const result = await lease.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ${table} WHERE organization_id = $1`,
      [organizationId],
    )
    counts[table] = result.rows[0]?.count ?? 0
  }
  return counts
}

async function receiptRows(
  organizationId: string,
): Promise<readonly Record<string, unknown>[]> {
  const result = await lease.pool.query(
    `SELECT context, phase, outcome, evidence_ref, lifecycle_revision
       FROM context_organization_lifecycle_receipts
      WHERE organization_id = $1
      ORDER BY phase, lifecycle_revision`,
    [organizationId],
  )
  return result.rows
}

async function seedFixture(
  label: string,
  options: Readonly<{ legalHold?: 'active' | 'released' }> = {},
): Promise<Fixture> {
  const suffix = randomUUID()
  const fixture: Fixture = {
    organizationId: `activity-lifecycle-${label}-${suffix}`,
    closureLineageId: randomUUID(),
    actorSubjectId: `activity-lifecycle-user-${suffix}`,
    holdId: randomUUID(),
    historyRecordId: randomUUID(),
  }
  organizations.add(fixture.organizationId)

  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Activity lifecycle fixture', $1, $2)`,
    [fixture.organizationId, REQUESTED_AT],
  )

  // Recent Activity: two projected entries plus their replay authority.
  for (const index of [1, 2]) {
    const entryId = randomUUID()
    const eventId = `event-${entryId}`
    await lease.pool.query(
      `INSERT INTO recent_activity_entries (
         id, actor_id, actor_name, actor_avatar_url, actor_role, action, resource_type,
         resource_id, property_id, organization_id, payload, event_id, source, created_at
       ) VALUES ($1, $2, 'Seeded Manager', 'https://example.test/avatar.png', 'manager',
                 'created', 'inbox_item', $3, NULL, $4, '{"seeded":true}'::jsonb,
                 $5, 'web', $6)`,
      [
        entryId,
        fixture.actorSubjectId,
        `inbox-${entryId}`,
        fixture.organizationId,
        eventId,
        REQUESTED_AT,
      ],
    )
    await lease.pool.query(
      `INSERT INTO recent_activity_replay_facts (
         replay_key, projection_id, source_kind, disposition, source_event_id,
         source_event_type, source_event_version, source_context, source_aggregate_id,
         organization_id, property_id, actor_subject_id, action, resource_type,
         resource_id, transition_payload, source, source_occurred_at, captured_at
       ) VALUES ($1, $2, 'durable_fact', 'projectable', $3, 'inbox.item_created', 1,
                 'inbox', $4, $5, NULL, $6, 'created', 'inbox_item', $7,
                 '{"seeded":true}'::jsonb, 'web', $8, $8)`,
      [
        `replay-${entryId}-${index}`,
        entryId,
        eventId,
        `inbox-${entryId}`,
        fixture.organizationId,
        fixture.actorSubjectId,
        `inbox-${entryId}`,
        REQUESTED_AT,
      ],
    )
  }
  await lease.pool.query(
    `INSERT INTO recent_activity_actor_label_redactions (
       organization_id, actor_subject_id, redacted_at, expires_at
     ) VALUES ($1, $2, $3, $4)`,
    [fixture.organizationId, fixture.actorSubjectId, REQUESTED_AT, RECOVERABLE_UNTIL],
  )

  // Independently retained evidence.
  await lease.pool.query(
    `INSERT INTO operational_action_history_heads (
       organization_id, last_sequence, last_recorded_at, updated_at
     ) VALUES ($1, 1, $2, $2)`,
    [fixture.organizationId, REQUESTED_AT],
  )
  await lease.pool.query(
    `INSERT INTO operational_action_history_records (
       id, organization_id, sequence, property_id, actor_type, actor_id, action,
       outcome, resource_type, resource_id, reason_code, provenance_kind,
       provenance_id, occurred_at, recorded_at
     ) VALUES ($1, $2, 1, NULL, 'user', $3, 'member.role_changed', 'succeeded',
               'member', $4, 'manager_requested', 'interactive_command', $5, $6, $6)`,
    [
      fixture.historyRecordId,
      fixture.organizationId,
      fixture.actorSubjectId,
      `member-${suffix}`,
      `command-${suffix}`,
      REQUESTED_AT,
    ],
  )
  await lease.pool.query(
    `INSERT INTO recent_activity_vocabulary_reconciliations (
       operation_id, organization_id, source_action, source_resource_type,
       target_action, target_resource_type, target_fingerprint_sha256, target_count,
       updated_count, authorized_by, authorization_evidence_ref, applied_at
     ) VALUES ($1, $2, 'invited', 'member', 'member_invited', 'member', $3, 1, 1,
               'operator:seed', 'ticket:seed-1', $4)`,
    [randomUUID(), fixture.organizationId, 'b'.repeat(64), REQUESTED_AT],
  )

  if (options.legalHold) {
    await lease.pool.query(
      `INSERT INTO operational_action_history_legal_holds (
         id, organization_id, reason_code, protects_from, protects_through,
         placed_at, placed_by_actor_id, released_at, released_by_actor_id,
         release_reason_code
       ) VALUES ($1, $2, 'regulatory_request', $3, NULL, $3, 'operator:seed',
                 $4, $5, $6)`,
      [
        fixture.holdId,
        fixture.organizationId,
        REQUESTED_AT,
        options.legalHold === 'released' ? REQUESTED_AT : null,
        options.legalHold === 'released' ? 'operator:seed' : null,
        options.legalHold === 'released' ? 'matter_closed' : null,
      ],
    )
  }
  return fixture
}

async function seedEmptyOrganization(): Promise<Fixture> {
  const suffix = randomUUID()
  const fixture: Fixture = {
    organizationId: `activity-lifecycle-empty-${suffix}`,
    closureLineageId: randomUUID(),
    actorSubjectId: `activity-lifecycle-user-${suffix}`,
    holdId: randomUUID(),
    historyRecordId: randomUUID(),
  }
  organizations.add(fixture.organizationId)
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Activity lifecycle empty fixture', $1, $2)`,
    [fixture.organizationId, REQUESTED_AT],
  )
  return fixture
}

/**
 * Walk the live authority to the state the phase requires, one legal edge at a
 * time. The revision guard advances by exactly one per update, so each phase
 * has a fixed revision: closing at 1, purge readiness at 2, purge at 4.
 */
async function advanceAuthority(
  fixture: Fixture,
  target: 'closure_requested' | 'closing' | 'purging',
): Promise<void> {
  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
        SET state = 'closure_requested', revision = 1, closure_lineage_id = $2,
            closure_requested_at = $3, recoverable_until = $4,
            reactivation_required = true, requested_by = 'admin:lifecycle-test',
            request_reason_code = 'test_workspace',
            request_support_evidence_ref = 'test:closure-request',
            last_transition_at = $3, last_actor_id = 'admin:lifecycle-test',
            last_reason_code = 'test_workspace',
            last_support_evidence_ref = 'test:closure-request'
      WHERE organization_id = $1`,
    [fixture.organizationId, fixture.closureLineageId, REQUESTED_AT, RECOVERABLE_UNTIL],
  )
  if (target === 'closure_requested') return

  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
        SET state = 'closing', revision = 2, last_transition_at = $2,
            last_reason_code = 'closing_prepared',
            last_support_evidence_ref = 'test:closing'
      WHERE organization_id = $1`,
    [fixture.organizationId, REQUESTED_AT],
  )
  if (target === 'closing') return

  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
        SET state = 'purge_pending', revision = 3, last_transition_at = $2,
            last_reason_code = 'recovery_window_elapsed',
            last_support_evidence_ref = 'test:purge-pending'
      WHERE organization_id = $1`,
    [fixture.organizationId, REQUESTED_AT],
  )
  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
        SET state = 'purging', revision = 4, irreversible_at = $2,
            last_transition_at = $2,
            last_reason_code = 'irreversible_purge_authorized',
            last_support_evidence_ref = 'test:purging'
      WHERE organization_id = $1`,
    [fixture.organizationId, REQUESTED_AT],
  )
}

/**
 * Append-only guards make production DELETE impossible — which is the property
 * under test — so fixture teardown suspends them explicitly rather than the
 * adapter quietly gaining a way around them.
 */
async function deleteGuardedFixtures(organizationIds: readonly string[]): Promise<void> {
  if (organizationIds.length === 0) return
  const client = await lease.pool.connect()
  try {
    await client.query('BEGIN')
    for (const [table, trigger] of HISTORY_GUARD_TRIGGERS) {
      await client.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`)
    }
    await client.query(
      `ALTER TABLE context_organization_lifecycle_receipts
       DISABLE TRIGGER context_organization_lifecycle_receipts_update_delete_guard`,
    )
    for (const [table] of HISTORY_GUARD_TRIGGERS) {
      await client.query(`DELETE FROM ${table} WHERE organization_id = ANY($1::text[])`, [
        organizationIds,
      ])
    }
    await client.query(
      `DELETE FROM context_organization_lifecycle_receipts
       WHERE organization_id = ANY($1::text[])`,
      [organizationIds],
    )
    for (const [table, trigger] of HISTORY_GUARD_TRIGGERS) {
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

describe.sequential('Activity Organization lifecycle contributor', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 3)
    db = drizzle(lease.pool) as Database
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    const ids = [...organizations]
    for (const table of [
      ...PROJECTION_TABLES,
      'recent_activity_vocabulary_reconciliations',
    ]) {
      await lease.pool.query(
        `DELETE FROM ${table} WHERE organization_id = ANY($1::text[])`,
        [ids],
      )
    }
    await deleteGuardedFixtures(ids)
    await deleteTestOrganizations(lease.pool, ids)
    organizations.clear()
  })

  it('prepares Closing without deleting or changing a single row', async () => {
    const fixture = await seedFixture('closing')
    await advanceAuthority(fixture, 'closure_requested')
    const before = await rowCounts(fixture.organizationId, [
      ...PROJECTION_TABLES,
      ...RETAINED_TABLES,
    ])
    const digest = await lease.pool.query(
      `SELECT md5(string_agg(row_to_json(e)::text, '|' ORDER BY id::text)) AS digest
         FROM recent_activity_entries e WHERE organization_id = $1`,
      [fixture.organizationId],
    )

    const result = await createActivityOrganizationLifecycleContributor(
      db,
    ).prepareClosing(requestFor(fixture, 1))

    expect(result).toEqual({
      outcome: 'complete',
      evidenceRef: 'activity:closing:frozen:entry-2:replay-2',
    })
    // Closing opens a recoverable window: the projection must survive intact.
    expect(
      await rowCounts(fixture.organizationId, [...PROJECTION_TABLES, ...RETAINED_TABLES]),
    ).toEqual(before)
    const afterDigest = await lease.pool.query(
      `SELECT md5(string_agg(row_to_json(e)::text, '|' ORDER BY id::text)) AS digest
         FROM recent_activity_entries e WHERE organization_id = $1`,
      [fixture.organizationId],
    )
    expect(afterDigest.rows[0]).toEqual(digest.rows[0])
  })

  it('replays Closing from its receipt instead of re-running the phase', async () => {
    const fixture = await seedFixture('replay')
    await advanceAuthority(fixture, 'closure_requested')
    const contributor = createActivityOrganizationLifecycleContributor(db)

    const first = await contributor.prepareClosing(requestFor(fixture, 1))
    const replay = await contributor.prepareClosing({
      ...requestFor(fixture, 1),
      occurredAt: new Date(OCCURRED_AT.getTime() + 60_000),
    })

    expect(replay).toEqual(first)
    expect(await receiptRows(fixture.organizationId)).toEqual([
      {
        context: 'activity',
        phase: 'closing',
        outcome: 'complete',
        evidence_ref: 'activity:closing:frozen:entry-2:replay-2',
        lifecycle_revision: 1,
      },
    ])
  })

  it('answers no_data for an Organization with no Recent Activity', async () => {
    const fixture = await seedEmptyOrganization()
    await advanceAuthority(fixture, 'closure_requested')

    const result = await createActivityOrganizationLifecycleContributor(
      db,
    ).prepareClosing(requestFor(fixture, 1))

    expect(result).toEqual({
      outcome: 'no_data',
      evidenceRef: 'activity:closing:frozen:entry-0:replay-0',
    })
    // Affirmative absence is persisted; an omitted contributor would make a
    // partial purge look complete.
    expect(await receiptRows(fixture.organizationId)).toHaveLength(1)
  })

  it('verifies purge readiness without mutating a single row', async () => {
    const fixture = await seedFixture('readiness', { legalHold: 'released' })
    await advanceAuthority(fixture, 'closing')
    const before = await rowCounts(fixture.organizationId, [
      ...PROJECTION_TABLES,
      ...RETAINED_TABLES,
    ])

    const result = await createActivityOrganizationLifecycleContributor(
      db,
    ).verifyPurgeReadiness(requestFor(fixture, 2))

    // A released hold is evidence, not a blocker.
    expect(result).toEqual({
      outcome: 'complete',
      evidenceRef: 'activity:purge_readiness:row-5',
    })
    expect(
      await rowCounts(fixture.organizationId, [...PROJECTION_TABLES, ...RETAINED_TABLES]),
    ).toEqual(before)
  })

  it('fails purge readiness closed while an Operational Action History legal hold is active', async () => {
    const fixture = await seedFixture('held', { legalHold: 'active' })
    await advanceAuthority(fixture, 'closing')

    await expect(
      createActivityOrganizationLifecycleContributor(db).verifyPurgeReadiness(
        requestFor(fixture, 2),
      ),
    ).rejects.toThrow(
      'Activity purge_readiness blocked: active_operational_history_legal_holds=1',
    )
    // Fail closed: no receipt, so the coordinator cannot advance the state.
    expect(await receiptRows(fixture.organizationId)).toEqual([])
  })

  it('refuses purge when a hold arrives after readiness passed', async () => {
    const fixture = await seedFixture('late-hold', { legalHold: 'active' })
    await advanceAuthority(fixture, 'purging')

    await expect(
      createActivityOrganizationLifecycleContributor(db).purge(requestFor(fixture, 4)),
    ).rejects.toThrow('Activity purge blocked: active_operational_history_legal_holds=1')
    // The irreversible phase rolled back whole: nothing was scrubbed.
    expect(await rowCounts(fixture.organizationId, PROJECTION_TABLES)).toEqual({
      recent_activity_actor_label_redactions: 1,
      recent_activity_entries: 2,
      recent_activity_replay_facts: 2,
    })
  })

  it('purges Recent Activity, retains Operational Action History, and touches no other tenant', async () => {
    const fixture = await seedFixture('purge', { legalHold: 'released' })
    const bystander = await seedFixture('bystander')
    await advanceAuthority(fixture, 'purging')
    const retainedBefore = await rowCounts(fixture.organizationId, RETAINED_TABLES)
    const bystanderProjection = await rowCounts(
      bystander.organizationId,
      PROJECTION_TABLES,
    )

    const contributor = createActivityOrganizationLifecycleContributor(db)
    const result = await contributor.purge(requestFor(fixture, 4))
    const replay = await contributor.purge(requestFor(fixture, 4))

    expect(result).toEqual({
      outcome: 'complete',
      evidenceRef: 'activity:purge:entry-2:replay-2:redaction-1',
    })
    expect(replay).toEqual(result)
    expect(await receiptRows(fixture.organizationId)).toHaveLength(1)
    // Recent Activity is gone, including the replay authority that could
    // otherwise rebuild it.
    expect(await rowCounts(fixture.organizationId, PROJECTION_TABLES)).toEqual({
      recent_activity_actor_label_redactions: 0,
      recent_activity_entries: 0,
      recent_activity_replay_facts: 0,
    })
    // Independently retained evidence survives untouched, identifiers included.
    expect(await rowCounts(fixture.organizationId, RETAINED_TABLES)).toEqual(
      retainedBefore,
    )
    const retainedRecord = await lease.pool.query<{
      actor_id: string | null
      resource_id: string | null
    }>(
      `SELECT actor_id, resource_id FROM operational_action_history_records WHERE id = $1`,
      [fixture.historyRecordId],
    )
    expect(retainedRecord.rows[0]?.actor_id).toBe(fixture.actorSubjectId)
    expect(retainedRecord.rows[0]?.resource_id).not.toBeNull()
    // No tenant-cross deletion.
    expect(await rowCounts(bystander.organizationId, PROJECTION_TABLES)).toEqual(
      bystanderProjection,
    )
  })

  it('answers no_data when a purged Organization owned no Recent Activity', async () => {
    const fixture = await seedEmptyOrganization()
    await advanceAuthority(fixture, 'purging')

    const result = await createActivityOrganizationLifecycleContributor(db).purge(
      requestFor(fixture, 4),
    )

    expect(result).toEqual({
      outcome: 'no_data',
      evidenceRef: 'activity:purge:entry-0:replay-0:redaction-0',
    })
  })
})
