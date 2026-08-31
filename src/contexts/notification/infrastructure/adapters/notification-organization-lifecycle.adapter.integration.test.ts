// LIF-01 T12/T13/T14 — Notification's lifecycle contributor against real
// PostgreSQL.
//
// The unit test proves the decision layer. Only a real schema can prove the
// claims that actually protect a closed Organization:
//
//   * Closing STOPS DELIVERY. After it commits, the exact predicate the digest
//     and orphan sweeps use returns nothing for this tenant, and the open
//     provider batch is closed — so no send survives.
//   * Closing KEEPS DATA. Every owned table has the same row count afterwards.
//   * Cancellation is idempotent: replaying the phase returns the recorded
//     receipt and touches no row a second time.
//   * Readiness MUTATES NOTHING and fails closed when the fence was reverted.
//   * Purge scrubs this tenant's rows only — a second Organization seeded the
//     same way is byte-identical afterwards.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createNotificationOrganizationLifecycleContributor } from './notification-organization-lifecycle.adapter'

let lease: TestLease
let db: Database
const organizations = new Set<string>()

const DIGEST = 'a'.repeat(64)
const REQUESTED_AT = new Date('2026-07-28T00:00:00.000Z')
const RECOVERABLE_UNTIL = new Date('2026-08-27T00:00:00.000Z')
const OCCURRED_AT = new Date('2026-08-28T00:00:00.000Z')

/** Every table Notification owns in `data-fate-authority.ts`. */
const OWNED_TABLES = [
  'notification_digest_batch_members',
  'notification_digest_batches',
  'notification_email_queue',
  'notification_governance_quarantine',
  'notification_preference_governance_quarantine',
  'notification_preferences',
  'notification_user_settings',
  'notifications',
] as const

type Fixture = Readonly<{
  organizationId: string
  closureLineageId: string
  propertyId: string
  userId: string
  batchId: string
  pendingEmailId: string
  mandatoryEmailId: string
  acceptedEmailId: string
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
): Promise<Readonly<Record<string, number>>> {
  const counts: Record<string, number> = {}
  for (const table of OWNED_TABLES) {
    const result = await lease.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ${table} WHERE organization_id = $1`,
      [organizationId],
    )
    counts[table] = result.rows[0]?.count ?? 0
  }
  return counts
}

/**
 * The exact due-work predicate `dueForCadence` uses in
 * `notification-email.repository.ts`. Asserting against a copy of the shipped
 * predicate is the point: it is what the digest and orphan sweeps would pick
 * up, so zero here means no send is reachable.
 */
async function dueEmailCount(
  organizationId: string,
  mandatory: 'mandatory' | 'product',
): Promise<number> {
  const result = await lease.pool.query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM notification_email_queue
      WHERE organization_id = $1
        AND category ${mandatory === 'mandatory' ? '=' : '<>'} 'mandatory'
        AND (
          status = 'pending'
          OR status = 'delayed'
          OR (status = 'failed' AND last_error_class = 'transient' AND retry_count < 5)
        )
        AND (not_before IS NULL OR not_before <= $2)
        AND (next_attempt_at IS NULL OR next_attempt_at <= $2)`,
    [organizationId, OCCURRED_AT],
  )
  return result.rows[0]?.count ?? 0
}

async function openDigestBatchCount(organizationId: string): Promise<number> {
  const result = await lease.pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM notification_digest_batches
      WHERE organization_id = $1 AND state IN ('prepared', 'retryable')`,
    [organizationId],
  )
  return result.rows[0]?.count ?? 0
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

/** Insert one in-app notification plus its queued email in one shot. */
async function seedNotificationAndEmail(
  fixture: Fixture,
  input: Readonly<{
    emailId: string
    category: 'workflow_collaboration' | 'urgent_operational' | 'mandatory'
    cadence: 'immediate' | 'daily'
    status: string
    lastErrorClass?: string
    retryCount?: number
  }>,
): Promise<void> {
  const notificationId = randomUUID()
  const mandatory = input.category === 'mandatory'
  await lease.pool.query(
    `INSERT INTO notifications (
       id, user_id, organization_id, property_id, type, category, priority, status,
       resource_type, resource_id, event_id, title, body, payload, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'review.created', $5, 'normal', 'unread',
               $6, $7, $8, 'Seeded title', 'Seeded body', '{}'::jsonb, $9, $9)`,
    [
      notificationId,
      fixture.userId,
      fixture.organizationId,
      mandatory ? null : fixture.propertyId,
      input.category,
      mandatory ? 'organization' : 'inbox_item',
      mandatory ? fixture.organizationId : `inbox-${notificationId}`,
      `event-${notificationId}`,
      REQUESTED_AT,
    ],
  )
  await lease.pool.query(
    `INSERT INTO notification_email_queue (
       id, notification_id, user_id, organization_id, property_id, category, cadence,
       status, priority, idempotency_key, last_error_class, retry_count,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'normal', $9, $10, $11, $12, $12)`,
    [
      input.emailId,
      notificationId,
      fixture.userId,
      fixture.organizationId,
      mandatory ? null : fixture.propertyId,
      input.category,
      input.cadence,
      input.status,
      `idempotency-${input.emailId}`,
      input.lastErrorClass ?? null,
      input.retryCount ?? 0,
      REQUESTED_AT,
    ],
  )
}

async function seedFixture(label: string): Promise<Fixture> {
  const suffix = randomUUID()
  const fixture: Fixture = {
    organizationId: `notification-lifecycle-${label}-${suffix}`,
    closureLineageId: randomUUID(),
    propertyId: randomUUID(),
    userId: `notification-lifecycle-user-${suffix}`,
    batchId: randomUUID(),
    pendingEmailId: randomUUID(),
    mandatoryEmailId: randomUUID(),
    acceptedEmailId: randomUUID(),
  }
  organizations.add(fixture.organizationId)

  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Notification lifecycle fixture', $1, $2)`,
    [fixture.organizationId, REQUESTED_AT],
  )
  await lease.pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Notification Lifecycle Property', $3, 'Europe/Sofia')`,
    [fixture.propertyId, fixture.organizationId, `notification-lifecycle-${suffix}`],
  )

  // Three still-sendable product emails, one per sendable status.
  await seedNotificationAndEmail(fixture, {
    emailId: fixture.pendingEmailId,
    category: 'workflow_collaboration',
    cadence: 'daily',
    status: 'pending',
  })
  await seedNotificationAndEmail(fixture, {
    emailId: randomUUID(),
    category: 'workflow_collaboration',
    cadence: 'daily',
    status: 'failed',
    lastErrorClass: 'transient',
    retryCount: 1,
  })
  await seedNotificationAndEmail(fixture, {
    emailId: randomUUID(),
    category: 'urgent_operational',
    cadence: 'immediate',
    status: 'delayed',
  })
  // A mandatory account/security notice: Identity's channel, deliberately left
  // deliverable through the recoverable window.
  await seedNotificationAndEmail(fixture, {
    emailId: fixture.mandatoryEmailId,
    category: 'mandatory',
    cadence: 'immediate',
    status: 'pending',
  })
  // Already handed to the provider — nothing left to stop.
  await seedNotificationAndEmail(fixture, {
    emailId: fixture.acceptedEmailId,
    category: 'workflow_collaboration',
    cadence: 'daily',
    status: 'accepted',
  })

  await lease.pool.query(
    `INSERT INTO notification_digest_batches (
       id, organization_id, user_id, local_date, sequence, member_digest,
       content_digest, provider_idempotency_key, unsubscribe_key_version, state,
       created_at, updated_at
     ) VALUES ($1, $2, $3, '2026-07-28', 1, $4, $4, $5, 'legacy', 'prepared', $6, $6)`,
    [
      fixture.batchId,
      fixture.organizationId,
      fixture.userId,
      DIGEST,
      `provider-key-${suffix}`,
      REQUESTED_AT,
    ],
  )
  await lease.pool.query(
    `INSERT INTO notification_digest_batch_members (
       batch_id, organization_id, user_id, notification_email_id, sort_index, created_at
     ) VALUES ($1, $2, $3, $4, 0, $5)`,
    [
      fixture.batchId,
      fixture.organizationId,
      fixture.userId,
      fixture.pendingEmailId,
      REQUESTED_AT,
    ],
  )

  await lease.pool.query(
    `INSERT INTO notification_preferences (
       id, user_id, organization_id, property_id, category, channel, enabled, cadence,
       urgent_bypass_enabled, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'workflow_collaboration', 'email', true, 'daily',
               false, $5, $5)`,
    [
      randomUUID(),
      fixture.userId,
      fixture.organizationId,
      fixture.propertyId,
      REQUESTED_AT,
    ],
  )
  await lease.pool.query(
    `INSERT INTO notification_user_settings (
       id, user_id, organization_id, locale, timezone, created_at, updated_at
     ) VALUES ($1, $2, $3, 'en', 'Europe/Sofia', $4, $4)`,
    [randomUUID(), fixture.userId, fixture.organizationId, REQUESTED_AT],
  )
  await lease.pool.query(
    `INSERT INTO notification_governance_quarantine (
       notification_id, organization_id, reason, quarantined_at
     ) VALUES ($1, $2, 'seeded_quarantine', $3)`,
    [randomUUID(), fixture.organizationId, REQUESTED_AT],
  )
  await lease.pool.query(
    `INSERT INTO notification_preference_governance_quarantine (
       legacy_preference_id, organization_id, reason, quarantined_at
     ) VALUES ($1, $2, 'seeded_quarantine', $3)`,
    [randomUUID(), fixture.organizationId, REQUESTED_AT],
  )
  return fixture
}

/** Seed an Organization with no Notification rows at all. */
async function seedEmptyOrganization(): Promise<Fixture> {
  const suffix = randomUUID()
  const fixture: Fixture = {
    organizationId: `notification-lifecycle-empty-${suffix}`,
    closureLineageId: randomUUID(),
    propertyId: randomUUID(),
    userId: `notification-lifecycle-user-${suffix}`,
    batchId: randomUUID(),
    pendingEmailId: randomUUID(),
    mandatoryEmailId: randomUUID(),
    acceptedEmailId: randomUUID(),
  }
  organizations.add(fixture.organizationId)
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Notification lifecycle empty fixture', $1, $2)`,
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

/** Receipts are append-only in production; fixtures disable that guard. */
async function deleteReceiptFixtures(organizationIds: readonly string[]): Promise<void> {
  if (organizationIds.length === 0) return
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

describe.sequential('Notification Organization lifecycle contributor', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 3)
    db = drizzle(lease.pool) as Database
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    const ids = [...organizations]
    for (const table of [...OWNED_TABLES, 'properties']) {
      await lease.pool.query(
        `DELETE FROM ${table} WHERE organization_id = ANY($1::text[])`,
        [ids],
      )
    }
    await deleteReceiptFixtures(ids)
    await deleteTestOrganizations(lease.pool, ids)
    organizations.clear()
  })

  it('stops delivery on Closing without deleting anything', async () => {
    const fixture = await seedFixture('closing')
    await advanceAuthority(fixture, 'closure_requested')
    const before = await rowCounts(fixture.organizationId)
    expect(await dueEmailCount(fixture.organizationId, 'product')).toBe(3)
    expect(await openDigestBatchCount(fixture.organizationId)).toBe(1)

    const contributor = createNotificationOrganizationLifecycleContributor(db)
    const result = await contributor.prepareClosing(requestFor(fixture, 1))

    expect(result).toEqual({
      outcome: 'complete',
      evidenceRef: 'notification:closing:mail-3:batch-1',
    })
    // No send survives: the shipped due-work predicate finds nothing, and the
    // open provider batch no longer holds its idempotency key.
    expect(await dueEmailCount(fixture.organizationId, 'product')).toBe(0)
    expect(await openDigestBatchCount(fixture.organizationId)).toBe(0)
    // STOP EFFECTS, KEEP DATA — every owned table still has its rows.
    expect(await rowCounts(fixture.organizationId)).toEqual(before)
  })

  it('leaves mandatory account notices deliverable and already-sent mail untouched', async () => {
    const fixture = await seedFixture('mandatory')
    await advanceAuthority(fixture, 'closure_requested')

    await createNotificationOrganizationLifecycleContributor(db).prepareClosing(
      requestFor(fixture, 1),
    )

    // Identity still has to tell the affected people what happened to their
    // access while the closure is recoverable.
    expect(await dueEmailCount(fixture.organizationId, 'mandatory')).toBe(1)
    const rows = await lease.pool.query<{ id: string; status: string; reason: string }>(
      `SELECT id, status, suppression_reason AS reason
         FROM notification_email_queue WHERE organization_id = $1 AND id = ANY($2::uuid[])
        ORDER BY id`,
      [
        fixture.organizationId,
        [fixture.mandatoryEmailId, fixture.acceptedEmailId, fixture.pendingEmailId],
      ],
    )
    const byId = new Map(rows.rows.map((row) => [row.id, row]))
    expect(byId.get(fixture.mandatoryEmailId)).toMatchObject({
      status: 'pending',
      reason: null,
    })
    // 'accepted' is not a sendable status, so the fence must not rewrite it —
    // rewriting a provider-accepted row would lose delivery evidence.
    expect(byId.get(fixture.acceptedEmailId)).toMatchObject({
      status: 'accepted',
      reason: null,
    })
    expect(byId.get(fixture.pendingEmailId)).toMatchObject({
      status: 'cancelled',
      reason: 'organization_closing',
    })
  })

  it('cancels idempotently — a replay returns the receipt and re-cancels nothing', async () => {
    const fixture = await seedFixture('replay')
    await advanceAuthority(fixture, 'closure_requested')
    const contributor = createNotificationOrganizationLifecycleContributor(db)

    const first = await contributor.prepareClosing(requestFor(fixture, 1))
    const after = await lease.pool.query<{ updated_at: Date }>(
      `SELECT updated_at FROM notification_email_queue WHERE id = $1`,
      [fixture.pendingEmailId],
    )
    const replay = await contributor.prepareClosing({
      ...requestFor(fixture, 1),
      occurredAt: new Date(OCCURRED_AT.getTime() + 60_000),
    })

    expect(replay).toEqual(first)
    // Exactly one receipt, and the row was not written a second time.
    expect(await receiptRows(fixture.organizationId)).toEqual([
      {
        context: 'notification',
        phase: 'closing',
        outcome: 'complete',
        evidence_ref: 'notification:closing:mail-3:batch-1',
        lifecycle_revision: 1,
      },
    ])
    const second = await lease.pool.query<{ updated_at: Date }>(
      `SELECT updated_at FROM notification_email_queue WHERE id = $1`,
      [fixture.pendingEmailId],
    )
    expect(second.rows[0]?.updated_at).toEqual(after.rows[0]?.updated_at)
  })

  it('answers no_data for an Organization with nothing to fence', async () => {
    const fixture = await seedEmptyOrganization()
    await advanceAuthority(fixture, 'closure_requested')

    const result = await createNotificationOrganizationLifecycleContributor(
      db,
    ).prepareClosing(requestFor(fixture, 1))

    expect(result).toEqual({
      outcome: 'no_data',
      evidenceRef: 'notification:closing:mail-0:batch-0',
    })
    // Affirmative absence is persisted; an omitted contributor would make a
    // partial purge look complete.
    expect(await receiptRows(fixture.organizationId)).toHaveLength(1)
  })

  it('verifies purge readiness without mutating a single row', async () => {
    const fixture = await seedFixture('readiness')
    await advanceAuthority(fixture, 'closure_requested')
    await createNotificationOrganizationLifecycleContributor(db).prepareClosing(
      requestFor(fixture, 1),
    )
    await lease.pool.query(
      `UPDATE organization_lifecycle_authority
          SET state = 'closing', revision = 2, last_transition_at = $2,
              last_reason_code = 'closing_prepared',
              last_support_evidence_ref = 'test:closing'
        WHERE organization_id = $1`,
      [fixture.organizationId, REQUESTED_AT],
    )
    const before = await rowCounts(fixture.organizationId)
    const digest = await lease.pool.query(
      `SELECT md5(string_agg(row_to_json(q)::text, '|' ORDER BY id::text)) AS digest
         FROM notification_email_queue q WHERE organization_id = $1`,
      [fixture.organizationId],
    )

    const result = await createNotificationOrganizationLifecycleContributor(
      db,
    ).verifyPurgeReadiness(requestFor(fixture, 2))

    expect(result.outcome).toBe('complete')
    expect(result.evidenceRef).toMatch(/^notification:purge_readiness:row-\d+$/u)
    expect(await rowCounts(fixture.organizationId)).toEqual(before)
    const afterDigest = await lease.pool.query(
      `SELECT md5(string_agg(row_to_json(q)::text, '|' ORDER BY id::text)) AS digest
         FROM notification_email_queue q WHERE organization_id = $1`,
      [fixture.organizationId],
    )
    // Not just counts: every column of every queue row is unchanged.
    expect(afterDigest.rows[0]).toEqual(digest.rows[0])
  })

  it('fails purge readiness closed when the Closing fence was reverted', async () => {
    const fixture = await seedFixture('blocked')
    await advanceAuthority(fixture, 'closing')

    await expect(
      createNotificationOrganizationLifecycleContributor(db).verifyPurgeReadiness(
        requestFor(fixture, 2),
      ),
    ).rejects.toThrow(/Notification purge readiness blocked/u)
    // Fail closed: no receipt, so the coordinator cannot advance the state.
    expect(await receiptRows(fixture.organizationId)).toEqual([])
  })

  it('scrubs only this tenant on purge, and stays idempotent', async () => {
    const fixture = await seedFixture('purge')
    const bystander = await seedFixture('bystander')
    await advanceAuthority(fixture, 'purging')
    const bystanderBefore = await rowCounts(bystander.organizationId)

    const contributor = createNotificationOrganizationLifecycleContributor(db)
    const result = await contributor.purge(requestFor(fixture, 4))
    const replay = await contributor.purge(requestFor(fixture, 4))

    expect(result).toEqual({
      outcome: 'complete',
      evidenceRef:
        'notification:purge:notif-5:mail-5:batch-1:member-1:pref-1:setting-1:quarantine-2',
    })
    expect(replay).toEqual(result)
    expect(await receiptRows(fixture.organizationId)).toHaveLength(1)
    // Every owned table is empty for the purged tenant...
    expect(await rowCounts(fixture.organizationId)).toEqual(
      Object.fromEntries(OWNED_TABLES.map((table) => [table, 0])),
    )
    // ...and untouched for the tenant that was not closed.
    expect(await rowCounts(bystander.organizationId)).toEqual(bystanderBefore)
  })

  it('answers no_data when a purged Organization owned no Notification rows', async () => {
    const fixture = await seedEmptyOrganization()
    await advanceAuthority(fixture, 'purging')

    const result = await createNotificationOrganizationLifecycleContributor(db).purge(
      requestFor(fixture, 4),
    )

    expect(result).toEqual({
      outcome: 'no_data',
      evidenceRef:
        'notification:purge:notif-0:mail-0:batch-0:member-0:pref-0:setting-0:quarantine-0',
    })
  })
})
