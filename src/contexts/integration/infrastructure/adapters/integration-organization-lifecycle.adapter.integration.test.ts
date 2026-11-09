// LIF-01-T12/T13/T14 — Integration lifecycle contributor against real PostgreSQL.
//
// The unit test proves the decision logic. Only a real schema can prove the
// three properties the recovery window depends on:
//   * `prepareClosing` DELETES NOTHING — every owned table keeps its row count
//     while every provider effect stops;
//   * `verifyPurgeReadiness` MUTATES NOTHING — a full column snapshot of every
//     owned table is byte-identical across the call;
//   * `purge` empties this tenant's provider content, leaves a second tenant
//     untouched, keeps every table and compatibility mirror in place, and
//     converges on replay.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { lockGoogleConnectionBindingAuthority } from '#/shared/db/google-connection-binding-authority'
import { createImportClaims } from '../../imports/import-claims.server'
import {
  CREATED_AT,
  MARKERS,
  seedIntegrationLifecycleFixture,
  type Fixture,
} from './integration-organization-lifecycle.test-fixtures'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import type { GoogleOrganizationClosureProviderPort } from '../../application/ports/google-organization-closure.port'
import {
  createIntegrationOrganizationLifecycleContributor,
  IntegrationPurgeReadinessBlockedError,
} from './integration-organization-lifecycle.adapter'

/**
 * Every Integration-owned, Organization-scoped table this contributor may
 * touch. `prepareClosing` must leave all of their counts unchanged, and
 * `verifyPurgeReadiness` must leave their full contents unchanged.
 */
const OWNED_TABLES = [
  'google_connections',
  'google_imports',
  'google_import_items',
  'idempotency_receipts',
  'authorization_execution_permits',
] as const

/** Rows this context keeps after purge, scrubbed to content-free facts. */
const RETAINED_TABLES = [
  'google_connections',
  'idempotency_receipts',
  'authorization_execution_permits',
] as const

const PURGED_TABLES = OWNED_TABLES.filter(
  (table) => !RETAINED_TABLES.includes(table as (typeof RETAINED_TABLES)[number]),
)

const fixtures: Fixture[] = []
const bareOrganizations = new Set<string>()
let lease: TestLease
let db: Database

const RECOVERABLE_UNTIL = new Date('2026-09-28T00:00:00.000Z')
const OCCURRED_AT = new Date('2026-08-28T00:00:00.000Z')

function contributionRequest(
  organizationId: string,
  closureLineageId: string,
  lifecycleRevision: number,
) {
  return {
    organizationId,
    closureLineageId,
    lifecycleRevision,
    recoverableUntil: RECOVERABLE_UNTIL,
    occurredAt: OCCURRED_AT,
  } as const
}

function recordingProvider(): GoogleOrganizationClosureProviderPort & {
  stopNotificationSubscriptions: ReturnType<typeof vi.fn>
  revokeCredentials: ReturnType<typeof vi.fn>
} {
  return {
    stopNotificationSubscriptions: vi.fn(async () => 'stopped' as const),
    revokeCredentials: vi.fn(async () => 'confirmed_revoked' as const),
  }
}

async function seedBareOrganization(): Promise<string> {
  const organizationId = `integration-lifecycle-bare-${randomUUID()}`
  bareOrganizations.add(organizationId)
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Integration lifecycle bare fixture', $1, $2)`,
    [organizationId, CREATED_AT],
  )
  return organizationId
}

/** The pending item reaches a terminal state the way the expiry sweep leaves it. */
async function cancelPendingSingleRootItems(organizationId: string): Promise<void> {
  await lease.pool.query(
    `UPDATE google_import_items
     SET status = 'cancelled', outcome_code = 'authorization_changed',
         first_terminal_at = $2, next_dispatch_at = NULL, connection_id = NULL,
         destination_property_id = NULL, provider_account_suffix = NULL,
         provider_location_suffix = NULL,
         expected_connection_lifecycle_version = NULL,
         expected_connection_access_version = NULL,
         expected_credential_generation = NULL,
         expected_execution_policy_version = NULL, expected_actor_role = NULL,
         expected_permission_digest = NULL, expected_principal_kind = NULL,
         expected_permission_version = NULL
     WHERE organization_id = $1 AND status IN ('pending', 'processing')`,
    [organizationId, OCCURRED_AT],
  )
}

async function seedFixture(): Promise<Fixture> {
  const fixture = await seedIntegrationLifecycleFixture(lease.pool)
  fixtures.push(fixture)
  return fixture
}

/**
 * The live authority is guarded: revisions advance by exactly one, only legal
 * edges are accepted, each edge demands its own reason code, and the closure
 * request evidence is immutable once written. So the fixture WALKS the real
 * state machine to the state a phase demands instead of writing it directly.
 */
const CLOSURE_STEPS = [
  { state: 'closure_requested', revision: 1, reason: 'test_workspace' },
  { state: 'closing', revision: 2, reason: 'closing_prepared' },
  { state: 'purge_pending', revision: 3, reason: 'recovery_window_elapsed' },
  { state: 'purging', revision: 4, reason: 'irreversible_purge_authorized' },
] as const

type ClosureState = (typeof CLOSURE_STEPS)[number]['state']

const REQUESTED_AT = new Date(OCCURRED_AT.getTime() - 60_000)

/** Revision the live authority carries once it reaches `state`. */
function revisionFor(state: ClosureState): number {
  return CLOSURE_STEPS.find((step) => step.state === state)!.revision
}

async function advanceAuthorityTo(
  organizationId: string,
  closureLineageId: string,
  target: ClosureState,
): Promise<void> {
  const current = await lease.pool.query(
    'SELECT revision FROM organization_lifecycle_authority WHERE organization_id = $1',
    [organizationId],
  )
  const currentRevision = (current.rows[0] as { revision: number }).revision
  for (const step of CLOSURE_STEPS) {
    if (step.revision <= currentRevision) continue
    const transitionAt = new Date(REQUESTED_AT.getTime() + step.revision * 1_000)
    if (step.revision === 1) {
      await lease.pool.query(
        `UPDATE organization_lifecycle_authority
         SET state = 'closure_requested', revision = 1, closure_lineage_id = $2,
             closure_requested_at = $3, recoverable_until = $4,
             reactivation_required = true,
             requested_by = 'admin:integration-lifecycle-test',
             request_reason_code = 'test_workspace',
             request_support_evidence_ref = 'test:closure-request',
             last_transition_at = $3,
             last_actor_id = 'admin:integration-lifecycle-test',
             last_reason_code = 'test_workspace',
             last_support_evidence_ref = 'test:closure-request'
         WHERE organization_id = $1`,
        [organizationId, closureLineageId, REQUESTED_AT, RECOVERABLE_UNTIL],
      )
    } else {
      await lease.pool.query(
        `UPDATE organization_lifecycle_authority
         SET state = $2, revision = $3, last_transition_at = $4,
             irreversible_at = CASE WHEN $2 = 'purging' THEN $4 ELSE irreversible_at END,
             last_actor_id = 'system:lifecycle', last_reason_code = $5,
             last_support_evidence_ref = 'test:phase'
         WHERE organization_id = $1`,
        [organizationId, step.state, step.revision, transitionAt, step.reason],
      )
    }
    if (step.state === target) return
  }
}

async function tableCounts(
  organizationId: string,
): Promise<Readonly<Record<string, number>>> {
  const counts: Record<string, number> = {}
  for (const table of OWNED_TABLES) {
    // Table names come from the frozen list above, never from a caller.
    const result =
      table === 'idempotency_receipts'
        ? await lease.pool.query(
            `SELECT count(*)::int AS count FROM idempotency_receipts
             WHERE scope IN ('google_oauth_exchange', 'google_disconnect_revoke')
               AND payload->>'organizationId' = $1`,
            [organizationId],
          )
        : await lease.pool.query(
            `SELECT count(*)::int AS count FROM ${table} WHERE organization_id = $1`,
            [organizationId],
          )
    counts[table] = Number(result.rows[0]?.count ?? 0)
  }
  return counts
}

/** Full row contents, ordered, as one comparable string per table. */
async function tableSnapshot(
  organizationId: string,
  tables: readonly string[] = OWNED_TABLES,
): Promise<string> {
  const parts: string[] = []
  for (const table of tables) {
    const result =
      table === 'idempotency_receipts'
        ? await lease.pool.query(
            `SELECT to_jsonb(t.*)::text AS row FROM idempotency_receipts AS t
             WHERE scope IN ('google_oauth_exchange', 'google_disconnect_revoke')
               AND payload->>'organizationId' = $1 ORDER BY to_jsonb(t.*)::text`,
            [organizationId],
          )
        : await lease.pool.query(
            `SELECT to_jsonb(t.*)::text AS row FROM ${table} AS t
             WHERE organization_id = $1 ORDER BY to_jsonb(t.*)::text`,
            [organizationId],
          )
    parts.push(`${table}:${result.rows.map((row) => String(row.row)).join('|')}`)
  }
  return parts.join('\n')
}

async function deleteReceipts(organizationIds: readonly string[]): Promise<void> {
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
       ENABLE TRIGGER organization_lifecycle_events_append_only`,
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  await lease.pool.query(
    `DELETE FROM idempotency_receipts
     WHERE scope IN ('google_oauth_exchange', 'google_disconnect_revoke')
       AND payload->>'organizationId' = $1`,
    [fixture.organizationId],
  )
  for (const table of [...OWNED_TABLES].reverse()) {
    if (table === 'idempotency_receipts') continue
    await lease.pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [
      fixture.organizationId,
    ])
  }
  await lease.pool.query('DELETE FROM properties WHERE organization_id = $1', [
    fixture.organizationId,
  ])
  await executeWithLastOwnerGuardDisabled(db, [
    sql`DELETE FROM member WHERE "organizationId" = ${fixture.organizationId}`,
  ])
  await deleteReceipts([fixture.organizationId])
  await deleteTestOrganizations(lease.pool, [fixture.organizationId])
  await lease.pool.query('DELETE FROM "user" WHERE id = $1', [fixture.userId])
}

describe.sequential('Integration Organization lifecycle contributor', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    db = drizzle(lease.pool) as Database
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    for (const fixture of fixtures) await cleanupFixture(fixture)
    fixtures.length = 0
    await deleteReceipts([...bareOrganizations])
    await deleteTestOrganizations(lease.pool, [...bareOrganizations])
    bareOrganizations.clear()
  })

  it('stops every provider effect at closing without deleting a single row', async () => {
    const fixture = await seedFixture()
    const lineage = randomUUID()
    await advanceAuthorityTo(fixture.organizationId, lineage, 'closure_requested')
    const before = await tableCounts(fixture.organizationId)
    const provider = recordingProvider()

    const result = await createIntegrationOrganizationLifecycleContributor({
      db,
      provider,
    }).prepareClosing(
      contributionRequest(
        fixture.organizationId,
        lineage,
        revisionFor('closure_requested'),
      ),
    )

    expect(result.outcome).toBe('complete')
    // Closing keeps data: not one row left any owned table.
    expect(await tableCounts(fixture.organizationId)).toEqual(before)

    expect(provider.stopNotificationSubscriptions).toHaveBeenCalledTimes(1)
    expect(provider.revokeCredentials).toHaveBeenCalledTimes(1)

    const connection = await lease.pool.query(
      `SELECT status, credential_use_state, google_subject, scopes,
              encrypted_access_token, encrypted_refresh_token,
              lifecycle_version, access_version, credential_generation, status_reason
       FROM google_connections WHERE organization_id = $1`,
      [fixture.organizationId],
    )
    expect(connection.rows[0]).toMatchObject({
      status: 'disconnected',
      credential_use_state: 'none',
      google_subject: null,
      scopes: [],
      encrypted_access_token: 'redacted',
      encrypted_refresh_token: 'redacted',
      // The version bumps are the fence every in-flight provider effect pins.
      lifecycle_version: 2,
      access_version: 2,
      credential_generation: 2,
      status_reason: 'organization_closing_from_active',
    })

    const singleRootParent = await lease.pool.query(
      `SELECT deletion_fence, wire_replay_digest IS NOT NULL AS keeps_replay_digest
       FROM google_imports WHERE organization_id = $1`,
      [fixture.organizationId],
    )
    expect(singleRootParent.rows[0]).toEqual({
      deletion_fence: 1,
      keeps_replay_digest: true,
    })

    const receipt = await lease.pool.query(
      `SELECT context, phase, payload->>'outcome' AS outcome,
              payload->>'evidenceRef' AS evidence_ref
       FROM organization_lifecycle_events
       WHERE organization_id = $1
         AND kind LIKE 'organization_lifecycle_contribution:%'`,
      [fixture.organizationId],
    )
    expect(receipt.rows[0]).toMatchObject({
      context: 'integration',
      phase: 'closing',
      outcome: 'complete',
    })
    const evidenceRef = (receipt.rows[0] as { evidence_ref: string }).evidence_ref
    for (const marker of Object.values(MARKERS)) {
      expect(evidenceRef).not.toContain(marker)
    }
    expect(evidenceRef).not.toContain(fixture.userId)
    expect(evidenceRef).not.toContain(fixture.connectionId)
  })

  it('replays a recorded closing receipt without a second provider call', async () => {
    const fixture = await seedFixture()
    const lineage = randomUUID()
    await advanceAuthorityTo(fixture.organizationId, lineage, 'closure_requested')
    const provider = recordingProvider()
    const contributor = createIntegrationOrganizationLifecycleContributor({
      db,
      provider,
    })
    const request = contributionRequest(
      fixture.organizationId,
      lineage,
      revisionFor('closure_requested'),
    )

    const first = await contributor.prepareClosing(request)
    const replay = await contributor.prepareClosing(request)

    expect(replay).toEqual(first)
    expect(provider.revokeCredentials).toHaveBeenCalledTimes(1)
    expect(provider.stopNotificationSubscriptions).toHaveBeenCalledTimes(1)
    const receipts = await lease.pool.query(
      `SELECT count(*)::int AS count FROM organization_lifecycle_events
       WHERE organization_id = $1 AND phase = 'closing'
         AND kind LIKE 'organization_lifecycle_contribution:%'`,
      [fixture.organizationId],
    )
    expect(receipts.rows[0]).toEqual({ count: 1 })
  })

  it('answers no_data for an Organization that never connected Google', async () => {
    const organizationId = await seedBareOrganization()
    const lineage = randomUUID()
    await advanceAuthorityTo(organizationId, lineage, 'closure_requested')
    const provider = recordingProvider()

    const result = await createIntegrationOrganizationLifecycleContributor({
      db,
      provider,
    }).prepareClosing(
      contributionRequest(organizationId, lineage, revisionFor('closure_requested')),
    )

    expect(result.outcome).toBe('no_data')
    expect(provider.revokeCredentials).not.toHaveBeenCalled()
    const receipt = await lease.pool.query(
      `SELECT payload->>'outcome' AS outcome FROM organization_lifecycle_events
       WHERE organization_id = $1 AND context = 'integration'
         AND kind LIKE 'organization_lifecycle_contribution:%'`,
      [organizationId],
    )
    // Affirmative absence is recorded; an omitted contributor would make a
    // partial purge look complete.
    expect(receipt.rows).toEqual([{ outcome: 'no_data' }])
  })

  it('refuses readiness while a provider effect is outstanding, and mutates nothing', async () => {
    const fixture = await seedFixture()
    const lineage = randomUUID()
    await advanceAuthorityTo(fixture.organizationId, lineage, 'closing')
    const before = await tableSnapshot(fixture.organizationId)

    const failure = await createIntegrationOrganizationLifecycleContributor({
      db,
      provider: recordingProvider(),
    })
      .verifyPurgeReadiness(
        contributionRequest(fixture.organizationId, lineage, revisionFor('closing')),
      )
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(IntegrationPurgeReadinessBlockedError)
    expect((failure as IntegrationPurgeReadinessBlockedError).blockers).toEqual([
      { code: 'live_connections', count: 1 },
      { code: 'in_flight_import_items', count: 1 },
    ])
    // Read only: the full contents of every owned table are unchanged.
    expect(await tableSnapshot(fixture.organizationId)).toEqual(before)
    const receipts = await lease.pool.query(
      `SELECT count(*)::int AS count FROM organization_lifecycle_events
       WHERE organization_id = $1
         AND kind LIKE 'organization_lifecycle_contribution:%'`,
      [fixture.organizationId],
    )
    expect(receipts.rows[0]).toEqual({ count: 0 })
  })

  it('accepts readiness once closing has fenced every provider effect', async () => {
    const fixture = await seedFixture()
    const lineage = randomUUID()
    await advanceAuthorityTo(fixture.organizationId, lineage, 'closure_requested')
    const contributor = createIntegrationOrganizationLifecycleContributor({
      db,
      provider: recordingProvider(),
    })
    await contributor.prepareClosing(
      contributionRequest(
        fixture.organizationId,
        lineage,
        revisionFor('closure_requested'),
      ),
    )
    // The expiry sweep terminalizes the fenced items during the recovery
    // window; readiness must observe that, not perform it.
    await cancelPendingSingleRootItems(fixture.organizationId)
    await advanceAuthorityTo(fixture.organizationId, lineage, 'closing')
    const before = await tableSnapshot(fixture.organizationId)

    const result = await contributor.verifyPurgeReadiness(
      contributionRequest(fixture.organizationId, lineage, revisionFor('closing')),
    )

    expect(result.outcome).toBe('complete')
    expect(await tableSnapshot(fixture.organizationId)).toEqual(before)
  })

  it('purges this tenant only, keeps retained evidence, and converges on replay', async () => {
    const fixture = await seedFixture()
    const neighbour = await seedFixture()
    const lineage = randomUUID()
    await advanceAuthorityTo(fixture.organizationId, lineage, 'purging')
    const neighbourBefore = await tableSnapshot(neighbour.organizationId)
    const contributor = createIntegrationOrganizationLifecycleContributor({
      db,
      provider: recordingProvider(),
    })
    const request = contributionRequest(
      fixture.organizationId,
      lineage,
      revisionFor('purging'),
    )

    const result = await contributor.purge(request)
    expect(result.outcome).toBe('complete')

    const counts = await tableCounts(fixture.organizationId)
    for (const table of PURGED_TABLES) expect(counts[table]).toBe(0)
    // Independently retained, content-free evidence survives.
    for (const table of RETAINED_TABLES) expect(counts[table]).toBeGreaterThan(0)

    const connection = await lease.pool.query(
      `SELECT connected_by, credential_authorized_by, credential_authorized_at,
              google_subject, scopes, status_reason, last_successful_sync_at
       FROM google_connections WHERE organization_id = $1`,
      [fixture.organizationId],
    )
    expect(connection.rows[0]).toEqual({
      connected_by: 'purged',
      credential_authorized_by: null,
      credential_authorized_at: null,
      google_subject: null,
      scopes: [],
      status_reason: 'organization_purged',
      last_successful_sync_at: null,
    })
    const attempt = await lease.pool.query(
      `SELECT
         payload->>'credentialBinding' AS credential_binding,
         payload->>'initiatorUserId' AS initiator_user_id
       FROM idempotency_receipts
       WHERE scope = 'google_disconnect_revoke'
         AND payload->>'organizationId' = $1`,
      [fixture.organizationId],
    )
    expect(attempt.rows[0]).toEqual({
      credential_binding: null,
      initiator_user_id: 'purged',
    })

    // No tenant identifier or provider marker survives anywhere this
    // contributor purges or retains.
    const surviving = await tableSnapshot(fixture.organizationId, OWNED_TABLES)
    for (const marker of Object.values(MARKERS)) {
      expect(surviving).not.toContain(marker)
    }
    expect(surviving).not.toContain(fixture.userId)

    // A neighbouring tenant is byte-identical.
    expect(await tableSnapshot(neighbour.organizationId)).toEqual(neighbourBefore)

    // Idempotent: the replayed receipt is returned and the counts do not move.
    expect(await contributor.purge(request)).toEqual(result)
    expect(await tableCounts(fixture.organizationId)).toEqual(counts)
    const receipts = await lease.pool.query(
      `SELECT count(*)::int AS count FROM organization_lifecycle_events
       WHERE organization_id = $1 AND phase = 'purge'
         AND kind LIKE 'organization_lifecycle_contribution:%'`,
      [fixture.organizationId],
    )
    expect(receipts.rows[0]).toEqual({ count: 1 })
  })

  it('refuses readiness for an import item still in flight on the single-root store', async () => {
    const fixture = await seedFixture()
    const lineage = randomUUID()
    await advanceAuthorityTo(fixture.organizationId, lineage, 'closure_requested')
    const contributor = createIntegrationOrganizationLifecycleContributor({
      db,
      provider: recordingProvider(),
    })
    await contributor.prepareClosing(
      contributionRequest(
        fixture.organizationId,
        lineage,
        revisionFor('closure_requested'),
      ),
    )
    await advanceAuthorityTo(fixture.organizationId, lineage, 'closing')

    const failure = await contributor
      .verifyPurgeReadiness(
        contributionRequest(fixture.organizationId, lineage, revisionFor('closing')),
      )
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(IntegrationPurgeReadinessBlockedError)
    expect((failure as IntegrationPurgeReadinessBlockedError).blockers).toEqual([
      { code: 'in_flight_import_items', count: 1 },
    ])
  })

  it('fences, then purges, an Organization whose only imports are on the single-root store', async () => {
    const fixture = await seedFixture()
    const neighbour = await seedFixture()
    const lineage = randomUUID()
    await advanceAuthorityTo(fixture.organizationId, lineage, 'closure_requested')
    const contributor = createIntegrationOrganizationLifecycleContributor({
      db,
      provider: recordingProvider(),
    })

    // Imports alone are a footprint: closing must not answer no_data.
    const closing = await contributor.prepareClosing(
      contributionRequest(
        fixture.organizationId,
        lineage,
        revisionFor('closure_requested'),
      ),
    )
    expect(closing.outcome).toBe('complete')

    await cancelPendingSingleRootItems(fixture.organizationId)
    await advanceAuthorityTo(fixture.organizationId, lineage, 'purging')
    const neighbourBefore = await tableSnapshot(neighbour.organizationId)

    const purged = await contributor.purge(
      contributionRequest(fixture.organizationId, lineage, revisionFor('purging')),
    )

    expect(purged.outcome).toBe('complete')
    const counts = await tableCounts(fixture.organizationId)
    expect(counts.google_imports).toBe(0)
    expect(counts.google_import_items).toBe(0)
    expect(await tableSnapshot(neighbour.organizationId)).toEqual(neighbourBefore)
  })
  it('closes an Organization while an import item effect is running, without waiting out the lock timeout', async () => {
    const fixture = await seedFixture()
    const lineage = randomUUID()
    await advanceAuthorityTo(fixture.organizationId, lineage, 'closure_requested')
    const claimFence = randomUUID()
    const now = new Date(CREATED_AT.getTime() + 3_600_000)
    const item = await lease.pool.query(
      `UPDATE google_import_items
       SET status = 'processing', highest_attempt_for_revision = 1,
           claim_fence = $2, claim_lease_expires_at = $3
       WHERE organization_id = $1 AND status = 'pending'
       RETURNING id, retry_revision, dispatch_epoch`,
      [fixture.organizationId, claimFence, new Date(now.getTime() + 3_600_000)],
    )
    const itemRow = item.rows[0] as {
      id: string
      retry_revision: number
      dispatch_epoch: number
    }

    // Several clients are in play at once: the effect's item lock, its
    // connection lock, and the closure.
    const wide = await acquireTestLease(getEnv().DATABASE_URL, 6)
    try {
      const clients = await Promise.all(
        Array.from({ length: 6 }, () => wide.pool.connect()),
      )
      try {
        await Promise.all(
          clients.map((client) => client.query("SET lock_timeout = '2s'")),
        )
      } finally {
        for (const client of clients) client.release()
      }
      const wideDb = drizzle(wide.pool) as Database
      let shareHeld!: () => void
      const shareIsHeld = new Promise<void>((resolve) => (shareHeld = resolve))
      let releaseEffect!: () => void
      const effectMayProceed = new Promise<void>((resolve) => (releaseEffect = resolve))

      const effectRun = createImportClaims(wideDb).runClaimedEffect(
        {
          organizationId: fixture.organizationId,
          itemId: itemRow.id,
          retryRevision: itemRow.retry_revision,
          attemptOrdinal: 1,
          dispatchEpoch: itemRow.dispatch_epoch,
          claimFence,
          now,
        },
        () =>
          wideDb.transaction(async (tx) => {
            const bound = await lockGoogleConnectionBindingAuthority(tx, {
              organizationId: fixture.organizationId,
              connectionId: fixture.connectionId,
            })
            shareHeld()
            await effectMayProceed
            return bound
          }),
      )
      await shareIsHeld

      const contributor = createIntegrationOrganizationLifecycleContributor({
        db: wideDb,
        provider: recordingProvider(),
      })
      const startedAt = Date.now()
      const closing = contributor.prepareClosing(
        contributionRequest(
          fixture.organizationId,
          lineage,
          revisionFor('closure_requested'),
        ),
      )

      try {
        // The closure queues on the connection the effect still holds; it does
        // not wait on the import root.
        await vi.waitFor(async () => {
          const blocked = await lease.pool.query(
            `SELECT 1 FROM pg_stat_activity
             WHERE datname = current_database() AND wait_event_type = 'Lock'
               AND query ILIKE '%google_connections%'`,
          )
          expect(blocked.rows.length).toBeGreaterThan(0)
        })
      } finally {
        releaseEffect()
      }

      const [effect, outcome] = await Promise.all([effectRun, closing])
      expect(effect).toEqual({ kind: 'executed', value: true })
      expect(outcome.outcome).toBe('complete')
      expect(Date.now() - startedAt).toBeLessThan(5_000)
    } finally {
      await wide.release()
    }
  })
})
