import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { auditLogs } from '#/shared/db/schema/audit'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import type { Tx } from '#/shared/outbox/commit'
import type { OrganizationLifecycleContributionInput } from '../application/ports/organization-lifecycle-contributor.port'
import {
  createIdentityOrganizationLifecycleContributor,
  type IdentityOrganizationLifecyclePhaseWork,
} from './identity-organization-lifecycle-contributor'

const organizations = new Set<string>()
let lease: TestLease
let db: Database

async function deleteLifecycleReceiptFixtures(
  organizationIds: readonly string[],
): Promise<void> {
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

function input(
  overrides: Partial<OrganizationLifecycleContributionInput> = {},
): OrganizationLifecycleContributionInput {
  const organizationId = overrides.organizationId ?? `lifecycle-org-${randomUUID()}`
  organizations.add(organizationId)
  return {
    organizationId,
    closureLineageId: randomUUID(),
    lifecycleRevision: 2,
    recoverableUntil: new Date('2026-09-28T00:00:00.000Z'),
    occurredAt: new Date('2026-08-28T00:00:00.000Z'),
    ...overrides,
  }
}

function contributor(work: IdentityOrganizationLifecyclePhaseWork) {
  return createIdentityOrganizationLifecycleContributor({
    db,
    prepareClosing: work,
    verifyPurgeReadiness: work,
    purge: work,
  })
}

type ContributorAuthorityState = 'closure_requested' | 'closing' | 'purging'

async function seedAuthority(
  contributionInput: OrganizationLifecycleContributionInput,
  targetState: ContributorAuthorityState,
): Promise<void> {
  const requestAt = new Date(contributionInput.occurredAt.getTime() - 5000)
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Lifecycle contributor fixture', $1, $2)`,
    [contributionInput.organizationId, requestAt],
  )
  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
     SET state = 'closure_requested', revision = 1,
         closure_lineage_id = $2, closure_requested_at = $3,
         recoverable_until = $4, reactivation_required = true,
         requested_by = 'admin:lifecycle-test',
         request_reason_code = 'test_workspace',
         request_support_evidence_ref = 'test:closure-request',
         last_transition_at = $3, last_actor_id = 'admin:lifecycle-test',
         last_reason_code = 'test_workspace',
         last_support_evidence_ref = 'test:closure-request'
     WHERE organization_id = $1`,
    [
      contributionInput.organizationId,
      contributionInput.closureLineageId,
      requestAt,
      contributionInput.recoverableUntil,
    ],
  )
  if (targetState === 'closure_requested') return

  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
     SET state = 'closing', revision = 2,
         last_transition_at = $2, last_actor_id = 'system:lifecycle',
         last_reason_code = 'closing_prepared',
         last_support_evidence_ref = 'test:closing-prepared'
     WHERE organization_id = $1`,
    [
      contributionInput.organizationId,
      new Date(contributionInput.occurredAt.getTime() - 4000),
    ],
  )
  if (targetState === 'closing') return

  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
     SET state = 'purge_pending', revision = 3,
         last_transition_at = $2, last_actor_id = 'support:lifecycle-test',
         last_reason_code = 'recovery_window_waived',
         last_support_evidence_ref = 'test:recovery-waived'
     WHERE organization_id = $1`,
    [
      contributionInput.organizationId,
      new Date(contributionInput.occurredAt.getTime() - 3000),
    ],
  )
  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
     SET state = 'purging', revision = 4, irreversible_at = $2,
         last_transition_at = $2, last_actor_id = 'support:lifecycle-test',
         last_reason_code = 'irreversible_purge_authorized',
         last_support_evidence_ref = 'test:purge-authorized'
     WHERE organization_id = $1`,
    [
      contributionInput.organizationId,
      new Date(contributionInput.occurredAt.getTime() - 2000),
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
    userId: 'system:lifecycle-test',
    action: 'identity.lifecycle.test_marker',
    resourceType: 'organization',
    resourceId: organizationId,
    details: null,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  })
}

describe.sequential('Identity Organization lifecycle contributor receipts', () => {
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
    await deleteLifecycleReceiptFixtures([...organizations])
    await deleteTestOrganizations(lease.pool, [...organizations])
    organizations.clear()
  })

  it('executes concurrent first attempts once and replays the durable result', async () => {
    const contributionInput = input({ lifecycleRevision: 1 })
    await seedAuthority(contributionInput, 'closure_requested')
    const markerId = randomUUID()
    const work = vi.fn(
      async (tx: Tx, current: OrganizationLifecycleContributionInput) => {
        await insertMarker(tx, current.organizationId, markerId, current.occurredAt)
        return {
          outcome: 'complete' as const,
          evidenceRef: `identity:closing:${current.closureLineageId}`,
        }
      },
    )
    const lifecycleContributor = contributor(work)

    const [first, concurrent] = await Promise.all([
      lifecycleContributor.prepareClosing(contributionInput),
      lifecycleContributor.prepareClosing({
        ...contributionInput,
        occurredAt: new Date('2026-08-28T00:01:00.000Z'),
      }),
    ])
    const replay = await lifecycleContributor.prepareClosing({
      ...contributionInput,
      occurredAt: new Date('2026-08-28T00:02:00.000Z'),
    })

    expect(concurrent).toEqual(first)
    expect(replay).toEqual(first)
    expect(work).toHaveBeenCalledTimes(1)
    const receipt = await lease.pool.query(
      `SELECT payload->>'outcome' AS outcome,
              payload->>'evidenceRef' AS evidence_ref,
              recorded_at AS occurred_at
       FROM organization_lifecycle_events
       WHERE organization_id = $1
         AND context = 'identity'
         AND kind LIKE 'organization_lifecycle_contribution:%'`,
      [contributionInput.organizationId],
    )
    expect(receipt.rows).toEqual([
      {
        outcome: 'complete',
        evidence_ref: `identity:closing:${contributionInput.closureLineageId}`,
        occurred_at: contributionInput.occurredAt,
      },
    ])
    const marker = await lease.pool.query(
      'SELECT count(*)::int AS count FROM audit_logs WHERE id = $1',
      [markerId],
    )
    expect(marker.rows[0]).toEqual({ count: 1 })

    await expect(
      lease.pool.query(
        `UPDATE organization_lifecycle_events
         SET payload = jsonb_set(payload, '{evidenceRef}', '"identity:tampered"')
         WHERE organization_id = $1`,
        [contributionInput.organizationId],
      ),
    ).rejects.toThrow(/append-only/)
    await expect(
      lease.pool.query(
        'DELETE FROM organization_lifecycle_events WHERE organization_id = $1',
        [contributionInput.organizationId],
      ),
    ).rejects.toThrow(/append-only/)
    await expect(
      lease.pool.query('TRUNCATE organization_lifecycle_events'),
    ).rejects.toThrow(/append-only/)
  })

  it('rolls back the phase mutation when its receipt result is unsafe', async () => {
    const contributionInput = input({ lifecycleRevision: 2 })
    await seedAuthority(contributionInput, 'closing')
    const markerId = randomUUID()
    const lifecycleContributor = contributor(async (tx, current) => {
      await insertMarker(tx, current.organizationId, markerId, current.occurredAt)
      return { outcome: 'complete', evidenceRef: 'unsafe evidence with spaces' }
    })

    await expect(
      lifecycleContributor.verifyPurgeReadiness(contributionInput),
    ).rejects.toThrow(/content-free identifier/)
    const counts = await lease.pool.query(
      `SELECT
         (SELECT count(*)::int FROM audit_logs WHERE id = $1) AS markers,
         (SELECT count(*)::int
          FROM organization_lifecycle_events
          WHERE organization_id = $2
            AND kind LIKE 'organization_lifecycle_contribution:%') AS receipts`,
      [markerId, contributionInput.organizationId],
    )
    expect(counts.rows[0]).toEqual({ markers: 0, receipts: 0 })
  })

  it('rejects a replay that changes the Organization binding', async () => {
    const first = input({ lifecycleRevision: 4 })
    await seedAuthority(first, 'purging')
    const secondOrganizationId = `lifecycle-org-${randomUUID()}`
    organizations.add(secondOrganizationId)
    const work = vi.fn(async () => ({
      outcome: 'no_data' as const,
      evidenceRef: `identity:empty:${first.closureLineageId}`,
    }))
    const lifecycleContributor = contributor(work)
    await lifecycleContributor.purge(first)

    await expect(
      lifecycleContributor.purge({
        ...first,
        organizationId: secondOrganizationId,
      }),
    ).rejects.toThrow(/authority changed/)
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('rejects missing and phase-mismatched lifecycle authority before work', async () => {
    const missing = input({ lifecycleRevision: 1 })
    const wrongState = input({ lifecycleRevision: 1 })
    await seedAuthority(wrongState, 'closure_requested')
    const work = vi.fn(async () => ({
      outcome: 'no_data' as const,
      evidenceRef: 'identity:no-data',
    }))
    const lifecycleContributor = contributor(work)

    await expect(lifecycleContributor.prepareClosing(missing)).rejects.toThrow(
      /authority changed/,
    )
    await expect(lifecycleContributor.verifyPurgeReadiness(wrongState)).rejects.toThrow(
      /authority changed/,
    )
    expect(work).not.toHaveBeenCalled()
  })

  it('holds the lifecycle authority row while phase work and its receipt commit', async () => {
    const contributionInput = input({ lifecycleRevision: 1 })
    await seedAuthority(contributionInput, 'closure_requested')
    let signalStarted!: () => void
    let releaseWork!: () => void
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve
    })
    const blocked = new Promise<void>((resolve) => {
      releaseWork = resolve
    })
    const lifecycleContributor = contributor(async () => {
      signalStarted()
      await blocked
      return { outcome: 'no_data', evidenceRef: 'identity:closing:no-data' }
    })
    const contribution = lifecycleContributor.prepareClosing(contributionInput)
    await started

    const cancellation = await lease.pool.connect()
    try {
      await cancellation.query('BEGIN')
      await cancellation.query(`SET LOCAL lock_timeout = '100ms'`)
      await expect(
        cancellation.query(
          `UPDATE organization_lifecycle_authority
           SET state = 'active', revision = 2, reactivation_required = true,
               last_transition_at = $2, last_actor_id = 'admin:lifecycle-test',
               last_reason_code = 'closure_cancelled',
               last_support_evidence_ref = 'test:closure-cancelled'
           WHERE organization_id = $1`,
          [
            contributionInput.organizationId,
            new Date(contributionInput.occurredAt.getTime() + 1000),
          ],
        ),
      ).rejects.toThrow(/lock timeout/)
    } finally {
      await cancellation.query('ROLLBACK')
      cancellation.release()
      releaseWork()
    }
    await expect(contribution).resolves.toMatchObject({ outcome: 'no_data' })

    await expect(
      lease.pool.query(
        `UPDATE organization_lifecycle_authority
         SET state = 'active', revision = 2, reactivation_required = true,
             last_transition_at = $2, last_actor_id = 'admin:lifecycle-test',
             last_reason_code = 'closure_cancelled',
             last_support_evidence_ref = 'test:closure-cancelled'
         WHERE organization_id = $1
         RETURNING state`,
        [
          contributionInput.organizationId,
          new Date(contributionInput.occurredAt.getTime() + 1000),
        ],
      ),
    ).resolves.toMatchObject({ rows: [{ state: 'active' }] })
  })
})
