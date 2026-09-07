// LIF-01-T3 — shared lifecycle receipt store against real PostgreSQL.
//
// The unit test proves the decision logic; only a real database can prove the
// two properties Wave 5's sixteen contributors depend on:
//   * two concurrent FIRST attempts serialize on pg_advisory_xact_lock and
//     produce exactly one receipt and exactly one phase mutation;
//   * the phase mutation and its receipt commit atomically — a thrown phase
//     leaves zero receipts AND zero mutated business rows.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { auditLogs } from '#/shared/db/schema/audit'
import type { Tx } from '#/shared/outbox/commit'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  createOrganizationLifecycleContributorScaffold,
  createOrganizationLifecycleReceiptStore,
  type OrganizationLifecycleContributionRequest,
} from './organization-lifecycle-receipt-store'

const organizations = new Set<string>()
let lease: TestLease
let db: Database

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

function request(
  overrides: Partial<OrganizationLifecycleContributionRequest> = {},
): OrganizationLifecycleContributionRequest {
  const organizationId = overrides.organizationId ?? `ctx-lifecycle-org-${randomUUID()}`
  organizations.add(organizationId)
  return {
    organizationId,
    closureLineageId: randomUUID(),
    lifecycleRevision: 1,
    recoverableUntil: new Date('2026-09-28T00:00:00.000Z'),
    occurredAt: new Date('2026-08-28T00:00:00.000Z'),
    ...overrides,
  }
}

/** Seeds the live authority into `closure_requested` at revision 1. */
async function seedClosureRequested(
  current: OrganizationLifecycleContributionRequest,
): Promise<void> {
  const requestedAt = new Date(current.occurredAt.getTime() - 5000)
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Shared lifecycle receipt fixture', $1, $2)`,
    [current.organizationId, requestedAt],
  )
  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
     SET state = 'closure_requested', revision = $5,
         closure_lineage_id = $2, closure_requested_at = $3,
         recoverable_until = $4, reactivation_required = true,
         requested_by = 'admin:shared-lifecycle-test',
         request_reason_code = 'test_workspace',
         request_support_evidence_ref = 'test:closure-request',
         last_transition_at = $3, last_actor_id = 'admin:shared-lifecycle-test',
         last_reason_code = 'test_workspace',
         last_support_evidence_ref = 'test:closure-request'
     WHERE organization_id = $1`,
    [
      current.organizationId,
      current.closureLineageId,
      requestedAt,
      current.recoverableUntil,
      current.lifecycleRevision,
    ],
  )
}

async function insertMarker(
  tx: Tx,
  organizationId: string,
  markerId: string,
  occurredAt: Date,
): Promise<void> {
  await tx.insert(auditLogs).values({
    id: markerId,
    organizationId,
    userId: 'system:shared-lifecycle-test',
    action: 'shared.lifecycle.test_marker',
    resourceType: 'organization',
    resourceId: organizationId,
    details: null,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  })
}

describe.sequential('shared Organization lifecycle events', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    db = drizzle(lease.pool) as Database
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    for (const organizationId of organizations) {
      await lease.pool.query('DELETE FROM audit_logs WHERE organization_id = $1', [
        organizationId,
      ])
    }
    await deleteReceiptFixtures([...organizations])
    await deleteTestOrganizations(lease.pool, [...organizations])
    organizations.clear()
  })

  it('serializes two concurrent first attempts into exactly one receipt and one mutation', async () => {
    const current = request()
    await seedClosureRequested(current)
    const markerId = randomUUID()
    const work = vi.fn(
      async (tx: Tx, incoming: OrganizationLifecycleContributionRequest) => {
        await insertMarker(tx, incoming.organizationId, markerId, incoming.occurredAt)
        return {
          outcome: 'complete' as const,
          evidenceRef: `inbox:closing:${incoming.closureLineageId}`,
        }
      },
    )
    const store = createOrganizationLifecycleReceiptStore({ db, context: 'inbox' })

    const [first, concurrent] = await Promise.all([
      store.run('closing', work, current),
      store.run('closing', work, {
        ...current,
        occurredAt: new Date('2026-08-28T00:01:00.000Z'),
      }),
    ])

    expect(concurrent).toEqual(first)
    expect(work).toHaveBeenCalledTimes(1)
    const receipts = await lease.pool.query(
      `SELECT context, phase, payload->>'outcome' AS outcome,
              payload->>'evidenceRef' AS evidence_ref
       FROM organization_lifecycle_events
       WHERE organization_id = $1
         AND kind LIKE 'organization_lifecycle_contribution:%'`,
      [current.organizationId],
    )
    expect(receipts.rows).toEqual([
      {
        context: 'inbox',
        phase: 'closing',
        outcome: 'complete',
        evidence_ref: `inbox:closing:${current.closureLineageId}`,
      },
    ])
    const marker = await lease.pool.query(
      'SELECT count(*)::int AS count FROM audit_logs WHERE id = $1',
      [markerId],
    )
    expect(marker.rows[0]).toEqual({ count: 1 })
  })

  it('keeps a receipt append-only once committed', async () => {
    const current = request()
    await seedClosureRequested(current)
    const store = createOrganizationLifecycleReceiptStore({ db, context: 'metric' })
    await store.run(
      'closing',
      async () => ({ outcome: 'no_data', evidenceRef: 'metric:closing:none' }),
      current,
    )

    await expect(
      lease.pool.query(
        `UPDATE organization_lifecycle_events
         SET payload = jsonb_set(payload, '{evidenceRef}', '"metric:tampered"')
         WHERE organization_id = $1`,
        [current.organizationId],
      ),
    ).rejects.toThrow(/append-only/u)
    await expect(
      lease.pool.query(
        'DELETE FROM organization_lifecycle_events WHERE organization_id = $1',
        [current.organizationId],
      ),
    ).rejects.toThrow(/append-only/u)
    await expect(
      lease.pool.query('TRUNCATE organization_lifecycle_events'),
    ).rejects.toThrow(/append-only/u)
  })

  it('leaves zero receipts and zero mutated business rows when phase work throws', async () => {
    const current = request()
    await seedClosureRequested(current)
    const markerId = randomUUID()
    const store = createOrganizationLifecycleReceiptStore({ db, context: 'review' })

    await expect(
      store.run(
        'closing',
        async (tx, incoming) => {
          await insertMarker(tx, incoming.organizationId, markerId, incoming.occurredAt)
          throw new Error('phase work exploded')
        },
        current,
      ),
    ).rejects.toThrow('phase work exploded')

    const counts = await lease.pool.query(
      `SELECT
         (SELECT count(*)::int FROM audit_logs WHERE id = $1) AS markers,
         (SELECT count(*)::int
          FROM organization_lifecycle_events
          WHERE organization_id = $2
            AND kind LIKE 'organization_lifecycle_contribution:%') AS receipts`,
      [markerId, current.organizationId],
    )
    expect(counts.rows[0]).toEqual({ markers: 0, receipts: 0 })
  })

  it('rolls the phase mutation back when the returned evidence is not content-free', async () => {
    const current = request()
    await seedClosureRequested(current)
    const markerId = randomUUID()
    const store = createOrganizationLifecycleReceiptStore({ db, context: 'portal' })

    await expect(
      store.run(
        'closing',
        async (tx, incoming) => {
          await insertMarker(tx, incoming.organizationId, markerId, incoming.occurredAt)
          return { outcome: 'complete', evidenceRef: 'unsafe evidence with spaces' }
        },
        current,
      ),
    ).rejects.toThrow(/content-free identifier/u)

    const counts = await lease.pool.query(
      `SELECT
         (SELECT count(*)::int FROM audit_logs WHERE id = $1) AS markers,
         (SELECT count(*)::int
          FROM organization_lifecycle_events
          WHERE organization_id = $2
            AND kind LIKE 'organization_lifecycle_contribution:%') AS receipts`,
      [markerId, current.organizationId],
    )
    expect(counts.rows[0]).toEqual({ markers: 0, receipts: 0 })
  })

  it('gives each context its own idempotency identity for the same lineage', async () => {
    const current = request()
    await seedClosureRequested(current)
    const contexts = ['inbox', 'review', 'staff'] as const
    for (const context of contexts) {
      const scaffold = createOrganizationLifecycleContributorScaffold({
        db,
        context,
        prepareClosing: async () => ({
          outcome: 'no_data',
          evidenceRef: `${context}:closing:none`,
        }),
        verifyPurgeReadiness: async () => ({
          outcome: 'no_data',
          evidenceRef: `${context}:readiness:none`,
        }),
        purge: async () => ({ outcome: 'no_data', evidenceRef: `${context}:purge:none` }),
      })
      // A dark context still answers affirmatively; an omitted contributor
      // would make a partial purge look complete.
      await expect(scaffold.prepareClosing(current)).resolves.toEqual({
        outcome: 'no_data',
        evidenceRef: `${context}:closing:none`,
      })
    }

    const rows = await lease.pool.query(
      `SELECT context FROM organization_lifecycle_events
       WHERE organization_id = $1 AND phase = 'closing'
         AND kind LIKE 'organization_lifecycle_contribution:%'
       ORDER BY context`,
      [current.organizationId],
    )
    expect(rows.rows.map((row: { context: string }) => row.context)).toEqual([
      'inbox',
      'review',
      'staff',
    ])
  })

  it('rejects a replay whose Organization binding changed', async () => {
    const current = request()
    await seedClosureRequested(current)
    const otherOrganizationId = `ctx-lifecycle-org-${randomUUID()}`
    organizations.add(otherOrganizationId)
    const work = vi.fn(async () => ({
      outcome: 'no_data' as const,
      evidenceRef: 'goal:closing:none',
    }))
    const store = createOrganizationLifecycleReceiptStore({ db, context: 'goal' })
    await store.run('closing', work, current)

    await expect(
      store.run('closing', work, { ...current, organizationId: otherOrganizationId }),
    ).rejects.toThrow(/authority changed/u)
    expect(work).toHaveBeenCalledTimes(1)
  })
})
