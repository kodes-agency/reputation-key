import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createOrganizationLifecycleCommandStore } from './organization-lifecycle-command-store'

const PREFIX = 'org-lifecycle-integration-'
const REQUESTED_AT = new Date('2026-08-28T09:30:00.000Z')
const RECOVERABLE_UNTIL = new Date('2026-09-27T09:30:00.000Z')

let lease: TestLease
let db: Database
const organizations = new Set<string>()
const users = new Set<string>()

type Fixture = Readonly<{
  organizationId: string
  actorUserId: string
}>

async function seedFixture(role = 'owner'): Promise<Fixture> {
  const suffix = randomUUID()
  const organizationId = `${PREFIX}org-${suffix}`
  const actorUserId = `${PREFIX}user-${suffix}`
  organizations.add(organizationId)
  users.add(actorUserId)
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Lifecycle fixture', $1, $2)`,
    [organizationId, REQUESTED_AT],
  )
  await lease.pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Lifecycle actor', $2, true, $3, $3)`,
    [actorUserId, `${actorUserId}@example.test`, REQUESTED_AT],
  )
  await lease.pool.query(
    `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
     VALUES ($1, $2, $3, $4, $5)`,
    [`${PREFIX}member-${suffix}`, actorUserId, organizationId, role, REQUESTED_AT],
  )
  // The database provisions the lifecycle authority in the exact Better Auth
  // Organization insert transaction. A fixture must exercise that same path.
  return { organizationId, actorUserId }
}

function request(fixture: Fixture, operationId = randomUUID()) {
  return {
    operationId,
    ...fixture,
    reasonCode: 'account_admin_request' as const,
    supportEvidenceRef: `support:${operationId}`,
    now: REQUESTED_AT,
    recoverableUntil: RECOVERABLE_UNTIL,
  }
}

async function state(organizationId: string) {
  const result = await lease.pool.query(
    `SELECT state, revision, closure_lineage_id, reactivation_required,
            irreversible_at, closed_at
     FROM organization_lifecycle_authority
     WHERE organization_id = $1`,
    [organizationId],
  )
  return result.rows[0]
}

function transition(
  fixture: Fixture,
  input: Readonly<{
    from: 'closure_requested' | 'closing' | 'purge_pending' | 'purging'
    to: 'active' | 'closing' | 'purge_pending' | 'purging' | 'closed'
    expectedRevision: number
    reasonCode:
      | 'closing_prepared'
      | 'recovery_window_elapsed'
      | 'purge_cancelled_before_irreversible'
      | 'irreversible_purge_authorized'
      | 'context_purge_complete'
    now?: Date
  }>,
) {
  return {
    organizationId: fixture.organizationId,
    closureLineageId: '',
    expectedRevision: input.expectedRevision,
    from: input.from,
    to: input.to,
    actorUserId: 'system:lifecycle',
    reasonCode: input.reasonCode,
    supportEvidenceRef: `lifecycle:${input.reasonCode}:sha256:${'a'.repeat(64)}`,
    now: input.now ?? new Date(REQUESTED_AT.getTime() + input.expectedRevision * 1000),
  } as const
}

async function factCount(organizationId: string): Promise<number> {
  const result = await lease.pool.query(
    `SELECT count(*)::int AS count
     FROM outbox_events
     WHERE organization_id = $1
       AND event_type = 'identity.organization_lifecycle.changed'`,
    [organizationId],
  )
  return result.rows[0]!.count as number
}

describe('Organization lifecycle command store (real PostgreSQL)', () => {
  beforeAll(async () => {
    registerAllEventSchemas()
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool)
  })

  afterAll(async () => {
    for (const organizationId of organizations) {
      await lease.pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [
        organizationId,
      ])
      await lease.pool.query(
        'DELETE FROM organization_lifecycle_command_receipts WHERE organization_id = $1',
        [organizationId],
      )
      await executeWithLastOwnerGuardDisabled(db, [
        sql`DELETE FROM member WHERE "organizationId" = ${organizationId}`,
      ])
      // The shared cleanup removes the lifecycle authority before deleting the
      // Organization. Its policy then cascades without tripping the deliberate
      // lifecycle fence exercised by this suite.
      await deleteTestOrganizations(lease.pool, [organizationId])
    }
    for (const userId of users) {
      await lease.pool.query('DELETE FROM "user" WHERE id = $1', [userId])
    }
    await lease.release()
  })

  it('co-commits the recoverable lifecycle revision, global suspension, and minimal fact', async () => {
    const fixture = await seedFixture()
    const store = createOrganizationLifecycleCommandStore(db)
    const versionBefore = await lease.pool.query(
      `SELECT version::int AS version FROM policy_version WHERE scope = 'global'`,
    )

    const result = await store.requestClosure(request(fixture))

    expect(result).toMatchObject({
      state: 'closure_requested',
      revision: 1,
      reactivationRequired: true,
      lastActorId: fixture.actorUserId,
      lastReasonCode: 'account_admin_request',
    })
    expect(result.recoverableUntil).toEqual(RECOVERABLE_UNTIL)
    const policy = await lease.pool.query(
      `SELECT suspended_at, suspended_reason
       FROM organization_policy WHERE organization_id = $1`,
      [fixture.organizationId],
    )
    expect(policy.rows[0]).toMatchObject({
      suspended_reason: 'lifecycle:closure_requested',
    })
    expect(policy.rows[0]!.suspended_at).toEqual(REQUESTED_AT)
    const versionAfter = await lease.pool.query(
      `SELECT version::int AS version FROM policy_version WHERE scope = 'global'`,
    )
    expect(versionAfter.rows[0]!.version).toBeGreaterThan(versionBefore.rows[0]!.version)
    expect(await factCount(fixture.organizationId)).toBe(1)
  })

  it.each(['after_state_and_fence', 'after_fact'] as const)(
    'rolls back state, suspension, receipt, and fact when interrupted at %s',
    async (faultStage) => {
      const fixture = await seedFixture()
      const store = createOrganizationLifecycleCommandStore(db, {
        interrupt: async (stage) => {
          if (stage === faultStage) throw new Error('simulated interruption')
        },
      })

      await expect(store.requestClosure(request(fixture))).rejects.toThrow(
        'simulated interruption',
      )

      expect(await state(fixture.organizationId)).toMatchObject({
        state: 'active',
        revision: 0,
        closure_lineage_id: null,
      })
      const policy = await lease.pool.query(
        'SELECT 1 FROM organization_policy WHERE organization_id = $1',
        [fixture.organizationId],
      )
      expect(policy.rowCount).toBe(0)
      expect(await factCount(fixture.organizationId)).toBe(0)
    },
  )

  it('replays one operation without adding a revision or second fact', async () => {
    const fixture = await seedFixture()
    const operationId = randomUUID()
    const store = createOrganizationLifecycleCommandStore(db)

    const first = await store.requestClosure(request(fixture, operationId))
    const replay = await store.requestClosure(request(fixture, operationId))

    expect(replay).toEqual(first)
    expect(await state(fixture.organizationId)).toMatchObject({ revision: 1 })
    expect(await factCount(fixture.organizationId)).toBe(1)
  })

  it('binds an operation id to the original actor, reason, and evidence reference', async () => {
    const fixture = await seedFixture()
    const operationId = randomUUID()
    const store = createOrganizationLifecycleCommandStore(db)
    await store.requestClosure(request(fixture, operationId))

    await expect(
      store.requestClosure({
        ...request(fixture, operationId),
        supportEvidenceRef: 'support:different-case',
      }),
    ).rejects.toMatchObject({ code: 'organization_conflict' })
    expect(await state(fixture.organizationId)).toMatchObject({ revision: 1 })
    expect(await factCount(fixture.organizationId)).toBe(1)
  })

  it('rejects direct lifecycle revision jumps', async () => {
    const fixture = await seedFixture()

    await expect(
      lease.pool.query(
        'UPDATE organization_lifecycle_authority SET revision = 2 WHERE organization_id = $1',
        [fixture.organizationId],
      ),
    ).rejects.toThrow(/revision must advance by exactly one/)
    expect(await state(fixture.organizationId)).toMatchObject({ revision: 0 })
  })

  it('serializes competing requests so exactly one establishes the closure lineage', async () => {
    const fixture = await seedFixture()
    const store = createOrganizationLifecycleCommandStore(db)

    const outcomes = await Promise.allSettled([
      store.requestClosure(request(fixture, randomUUID())),
      store.requestClosure(request(fixture, randomUUID())),
    ])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
    expect(await state(fixture.organizationId)).toMatchObject({ revision: 1 })
    expect(await factCount(fixture.organizationId)).toBe(1)
  })

  it('denies a PropertyManager and an AccountAdmin from another tenant', async () => {
    const target = await seedFixture()
    const manager = await seedFixture('admin')
    const otherOwner = await seedFixture()
    const store = createOrganizationLifecycleCommandStore(db)

    await expect(store.requestClosure(request(manager))).rejects.toMatchObject({
      code: 'forbidden',
    })
    await expect(
      store.requestClosure(
        request({
          organizationId: target.organizationId,
          actorUserId: otherOwner.actorUserId,
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(await state(target.organizationId)).toMatchObject({
      state: 'active',
      revision: 0,
    })
  })

  it('cancels only inside the recoverable window and retains the global suspension', async () => {
    const fixture = await seedFixture()
    const store = createOrganizationLifecycleCommandStore(db)
    await store.requestClosure(request(fixture))
    const cancelOperationId = randomUUID()

    const cancelled = await store.cancelClosure({
      operationId: cancelOperationId,
      ...fixture,
      reasonCode: 'closure_cancelled',
      supportEvidenceRef: `support:${cancelOperationId}`,
      now: new Date('2026-09-01T09:30:00.000Z'),
    })
    const replay = await store.cancelClosure({
      operationId: cancelOperationId,
      ...fixture,
      reasonCode: 'closure_cancelled',
      supportEvidenceRef: `support:${cancelOperationId}`,
      now: new Date('2026-09-01T09:30:00.000Z'),
    })

    expect(cancelled).toMatchObject({
      state: 'active',
      revision: 2,
      reactivationRequired: true,
    })
    expect(replay).toEqual(cancelled)
    const policy = await lease.pool.query(
      'SELECT suspended_at FROM organization_policy WHERE organization_id = $1',
      [fixture.organizationId],
    )
    expect(policy.rows[0]!.suspended_at).toEqual(REQUESTED_AT)
    expect(await factCount(fixture.organizationId)).toBe(2)

    await expect(
      lease.pool.query(
        'UPDATE organization_policy SET suspended_at = NULL, suspended_reason = NULL WHERE organization_id = $1',
        [fixture.organizationId],
      ),
    ).rejects.toThrow(/requires explicit reactivation/)
    await expect(
      lease.pool.query('DELETE FROM organization_policy WHERE organization_id = $1', [
        fixture.organizationId,
      ]),
    ).rejects.toThrow(/requires explicit reactivation/)
  })

  it('allows cancellation from Closing while preserving explicit reactivation', async () => {
    const fixture = await seedFixture()
    const store = createOrganizationLifecycleCommandStore(db)
    const requested = await store.requestClosure(request(fixture))
    await store.transition({
      ...transition(fixture, {
        from: 'closure_requested',
        to: 'closing',
        expectedRevision: 1,
        reasonCode: 'closing_prepared',
      }),
      closureLineageId: requested.closureLineageId!,
    })

    const cancelled = await store.cancelClosure({
      operationId: randomUUID(),
      ...fixture,
      reasonCode: 'closure_cancelled',
      supportEvidenceRef: 'support:closing-cancel',
      now: new Date('2026-09-01T09:30:00.000Z'),
    })

    expect(cancelled).toMatchObject({
      state: 'active',
      revision: 3,
      reactivationRequired: true,
    })
  })

  it('refuses reactivation from a state other than active-awaiting-reactivation', async () => {
    const fixture = await seedFixture()
    const store = createOrganizationLifecycleCommandStore(db)
    const requested = await store.requestClosure(request(fixture))

    await expect(
      store.reactivate({
        operationId: randomUUID(),
        ...fixture,
        expectedRevision: requested.revision,
        closureLineageId: requested.closureLineageId!,
        supportEvidenceRef: `lifecycle:reactivation:${'a'.repeat(64)}`,
        now: new Date('2026-09-01T09:30:00.000Z'),
      }),
    ).rejects.toMatchObject({ _tag: 'IdentityError', code: 'forbidden' })

    expect(await state(fixture.organizationId)).toMatchObject({
      state: 'closure_requested',
      revision: 1,
      reactivation_required: true,
    })
  })

  it('compare-and-sets reactivation on the revision its readiness evidence describes', async () => {
    const fixture = await seedFixture()
    const store = createOrganizationLifecycleCommandStore(db)
    const requested = await store.requestClosure(request(fixture))
    const cancelled = await store.cancelClosure({
      operationId: randomUUID(),
      ...fixture,
      reasonCode: 'closure_cancelled',
      supportEvidenceRef: 'support:cas-cancel',
      now: new Date('2026-09-01T09:30:00.000Z'),
    })

    await expect(
      store.reactivate({
        operationId: randomUUID(),
        ...fixture,
        // Stale: readiness was evaluated one revision earlier.
        expectedRevision: cancelled.revision - 1,
        closureLineageId: requested.closureLineageId!,
        supportEvidenceRef: `lifecycle:reactivation:${'b'.repeat(64)}`,
        now: new Date('2026-09-01T10:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'organization_conflict' })

    expect(await state(fixture.organizationId)).toMatchObject({
      reactivation_required: true,
    })
  })

  /**
   * Migration reservation: the reactivation edge is NOT in this repository yet.
   *
   * Migration 0159 predates LIF-01-T18 and fences the write twice — the
   * revision guard allows no `active -> active` edge, and the receipt table
   * allows only the 'request' and 'cancel' operations. Both belong to the
   * migration integrator, and only that owner may add them.
   *
   * This test therefore pins the CURRENT, verified behaviour: reactivation
   * fails closed at the database rather than half-lifting the fence. When the
   * migration lands, this expectation flips to a successful lift and the
   * `reactivation_required = false` / suspension-cleared assertions replace it.
   */
  it('fails closed at the database until the reactivation migration lands', async () => {
    const fixture = await seedFixture()
    const store = createOrganizationLifecycleCommandStore(db)
    const requested = await store.requestClosure(request(fixture))
    const cancelled = await store.cancelClosure({
      operationId: randomUUID(),
      ...fixture,
      reasonCode: 'closure_cancelled',
      supportEvidenceRef: 'support:reactivate-cancel',
      now: new Date('2026-09-01T09:30:00.000Z'),
    })

    const failure = await store
      .reactivate({
        operationId: randomUUID(),
        ...fixture,
        expectedRevision: cancelled.revision,
        closureLineageId: requested.closureLineageId!,
        supportEvidenceRef: `lifecycle:reactivation:${'c'.repeat(64)}`,
        now: new Date('2026-09-01T10:00:00.000Z'),
      })
      .catch((error: unknown) => error)

    // Drizzle wraps the driver error; the trigger message is the cause.
    expect(String((failure as { cause?: { message?: string } }).cause?.message)).toMatch(
      /invalid organization lifecycle state transition: active -> active/u,
    )

    // The fence is intact: nothing was partially lifted.
    expect(await state(fixture.organizationId)).toMatchObject({
      state: 'active',
      revision: cancelled.revision,
      reactivation_required: true,
    })
    const policy = await lease.pool.query(
      'SELECT suspended_at FROM organization_policy WHERE organization_id = $1',
      [fixture.organizationId],
    )
    expect(policy.rows[0]?.suspended_at).not.toBeNull()
  })

  it('advances through a recoverable Purge Pending state before the irreversible boundary', async () => {
    const fixture = await seedFixture()
    const store = createOrganizationLifecycleCommandStore(db)
    const requested = await store.requestClosure(request(fixture))
    const lineage = requested.closureLineageId!

    const closing = await store.transition({
      ...transition(fixture, {
        from: 'closure_requested',
        to: 'closing',
        expectedRevision: 1,
        reasonCode: 'closing_prepared',
      }),
      closureLineageId: lineage,
    })
    const pending = await store.transition({
      ...transition(fixture, {
        from: 'closing',
        to: 'purge_pending',
        expectedRevision: 2,
        reasonCode: 'recovery_window_elapsed',
      }),
      closureLineageId: lineage,
    })
    expect(closing.irreversibleAt).toBeNull()
    expect(pending.irreversibleAt).toBeNull()

    const irreversibleAt = new Date('2026-09-28T09:30:00.000Z')
    const purging = await store.transition({
      ...transition(fixture, {
        from: 'purge_pending',
        to: 'purging',
        expectedRevision: 3,
        reasonCode: 'irreversible_purge_authorized',
        now: irreversibleAt,
      }),
      closureLineageId: lineage,
    })
    const closedAt = new Date('2026-09-28T10:30:00.000Z')
    const closed = await store.transition({
      ...transition(fixture, {
        from: 'purging',
        to: 'closed',
        expectedRevision: 4,
        reasonCode: 'context_purge_complete',
        now: closedAt,
      }),
      closureLineageId: lineage,
    })

    expect(purging.irreversibleAt).toEqual(irreversibleAt)
    expect(closed).toMatchObject({ state: 'closed', revision: 5 })
    expect(closed.irreversibleAt).toEqual(irreversibleAt)
    expect(closed.closedAt).toEqual(closedAt)
    expect(await factCount(fixture.organizationId)).toBe(5)
  })

  it('allows an authorized recovery from Purge Pending while retaining the reactivation fence', async () => {
    const fixture = await seedFixture()
    const store = createOrganizationLifecycleCommandStore(db)
    const requested = await store.requestClosure(request(fixture))
    const lineage = requested.closureLineageId!

    await store.transition({
      ...transition(fixture, {
        from: 'closure_requested',
        to: 'closing',
        expectedRevision: 1,
        reasonCode: 'closing_prepared',
      }),
      closureLineageId: lineage,
    })
    await store.transition({
      ...transition(fixture, {
        from: 'closing',
        to: 'purge_pending',
        expectedRevision: 2,
        reasonCode: 'recovery_window_elapsed',
      }),
      closureLineageId: lineage,
    })

    const recovered = await store.transition({
      ...transition(fixture, {
        from: 'purge_pending',
        to: 'active',
        expectedRevision: 3,
        reasonCode: 'purge_cancelled_before_irreversible',
      }),
      closureLineageId: lineage,
      actorUserId: 'support:operator-1',
    })

    expect(recovered).toMatchObject({
      state: 'active',
      revision: 4,
      reactivationRequired: true,
    })
    expect(recovered.irreversibleAt).toBeNull()
    const policy = await lease.pool.query(
      'SELECT suspended_at FROM organization_policy WHERE organization_id = $1',
      [fixture.organizationId],
    )
    expect(policy.rows[0]!.suspended_at).toEqual(REQUESTED_AT)
    expect(await factCount(fixture.organizationId)).toBe(4)
  })

  it('replays an exact stage transition without another revision or fact', async () => {
    const fixture = await seedFixture()
    const store = createOrganizationLifecycleCommandStore(db)
    const requested = await store.requestClosure(request(fixture))
    const command = {
      ...transition(fixture, {
        from: 'closure_requested',
        to: 'closing',
        expectedRevision: 1,
        reasonCode: 'closing_prepared',
      }),
      closureLineageId: requested.closureLineageId!,
    }

    const first = await store.transition(command)
    const replay = await store.transition(command)

    expect(replay).toEqual(first)
    expect(await state(fixture.organizationId)).toMatchObject({ revision: 2 })
    expect(await factCount(fixture.organizationId)).toBe(2)
  })
})
