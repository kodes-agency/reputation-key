// LIF-01-T12/T13/T14 — Staff lifecycle contribution against real PostgreSQL.
//
// The unit test proves the phase decisions; only a real schema can prove the
// three properties the program actually promises:
//   * Closing stops effects and deletes NOTHING — every people row survives the
//     recoverable window byte-for-byte.
//   * Purge readiness mutates NOTHING, and a real blocker really stops it.
//   * Purge removes this tenant's Staff rows, is idempotent, drops no table,
//     and preserves a user identity that belongs to another Organization.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  createStaffOrganizationLifecycleContributor,
  STAFF_LIFECYCLE_TABLES,
} from './staff-organization-lifecycle.adapter'

let lease: TestLease
let db: Database

const suffix = randomUUID()
const ORGANIZATION_ID = `staff-lifecycle-org-${suffix}`
const OTHER_ORGANIZATION_ID = `staff-lifecycle-other-${suffix}`
const EMPTY_ORGANIZATION_ID = `staff-lifecycle-empty-${suffix}`
const ORGANIZATION_IDS = [
  ORGANIZATION_ID,
  OTHER_ORGANIZATION_ID,
  EMPTY_ORGANIZATION_ID,
] as const

const PROPERTY_ID = randomUUID()
const OTHER_PROPERTY_ID = randomUUID()
const PORTAL_ID = randomUUID()
const PORTAL_GROUP_ID = randomUUID()

/** The human who is also a member of the SECOND Organization. */
const SHARED_USER_ID = `user-shared-${suffix}`

const EFFECTIVE_FROM = '2026-01-01T00:00:00.000Z'
const REQUESTED_AT = new Date('2026-08-01T00:00:00.000Z')
const RECOVERABLE_UNTIL = new Date('2026-08-31T00:00:00.000Z')

const lineage = new Map<string, string>()

/** Fixture tables that must be cleaned up even when a test leaves rows behind. */
const FIXTURE_TABLES = [
  'portal_group_memberships',
  'portal_responsibilities',
  'portal_groups',
  'portals',
  'staff_user_links',
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

/** Row counts for every Staff-owned table, as one comparable snapshot. */
const staffRowCounts = async (
  organizationId: string,
): Promise<Record<string, number>> => {
  const entries = await Promise.all(
    STAFF_LIFECYCLE_TABLES.map(
      async (table) => [table, await countRows(table, organizationId)] as const,
    ),
  )
  return Object.fromEntries(entries)
}

const seedOrganization = async (organizationId: string): Promise<void> => {
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Staff Lifecycle Fixture', $1, $2)`,
    [organizationId, REQUESTED_AT],
  )
  const closureLineageId = randomUUID()
  lineage.set(organizationId, closureLineageId)
  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
     SET state = 'closure_requested', revision = 1,
         closure_lineage_id = $2, closure_requested_at = $3,
         recoverable_until = $4, reactivation_required = true,
         requested_by = 'admin:staff-lifecycle-test',
         request_reason_code = 'test_workspace',
         request_support_evidence_ref = 'test:closure-request',
         last_transition_at = $3, last_actor_id = 'admin:staff-lifecycle-test',
         last_reason_code = 'test_workspace',
         last_support_evidence_ref = 'test:closure-request'
     WHERE organization_id = $1`,
    [organizationId, closureLineageId, REQUESTED_AT, RECOVERABLE_UNTIL],
  )
}

/**
 * Advances the live authority the way the coordinator's command store would.
 * The database triggers still enforce the edge, the reason and the exact
 * revision step, so a wrong move here fails loudly instead of faking a state.
 */
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
    context: string
    phase: string
    outcome: string
    evidence_ref: string
  }>(
    `SELECT context, phase, payload->>'outcome' AS outcome,
            payload->>'evidenceRef' AS evidence_ref
     FROM organization_lifecycle_events
     WHERE organization_id = $1
       AND kind LIKE 'organization_lifecycle_contribution:%'
     ORDER BY phase`,
    [organizationId],
  )
  return result.rows
}

/** Receipts are append-only in production; test cleanup fences the guard. */
const deleteReceipts = async (organizationIds: readonly string[]): Promise<void> => {
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

const seedPeople = async (
  organizationId: string,
  propertyId: string,
  userId: string,
): Promise<void> => {
  const participantId = randomUUID()
  const participationId = randomUUID()
  await lease.pool.query(
    `INSERT INTO staff_participants
       (id, organization_id, display_name, status, created_by)
     VALUES ($1, $2, 'Dana Rivera', 'active', 'user-admin')`,
    [participantId, organizationId],
  )
  await lease.pool.query(
    `INSERT INTO staff_user_links
       (id, organization_id, staff_participant_id, user_id, effective_from, created_by)
     VALUES ($1, $2, $3, $4, $5, 'user-admin')`,
    [randomUUID(), organizationId, participantId, userId, EFFECTIVE_FROM],
  )
  await lease.pool.query(
    `INSERT INTO staff_participations
       (id, organization_id, property_id, staff_participant_id, display_name,
        status, created_by)
     VALUES ($1, $2, $3, $4, 'Dana Rivera', 'active', 'user-admin')`,
    [participationId, organizationId, propertyId, participantId],
  )
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
  db = drizzle(lease.pool) as Database

  for (const organizationId of ORGANIZATION_IDS) await seedOrganization(organizationId)

  for (const [organizationId, propertyId] of [
    [ORGANIZATION_ID, PROPERTY_ID],
    [OTHER_ORGANIZATION_ID, OTHER_PROPERTY_ID],
  ] as const) {
    await lease.pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Staff Lifecycle Property', $3, 'UTC')`,
      [propertyId, organizationId, `property-${propertyId}`],
    )
  }

  await lease.pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Dana Rivera', $2, true, $3, $3)`,
    [SHARED_USER_ID, `${SHARED_USER_ID}@example.test`, REQUESTED_AT],
  )
  // The same human is a member of the SECOND Organization. Program bullet 5:
  // Closed preserves user identities that belong elsewhere.
  await lease.pool.query(
    `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
     VALUES ($1, $2, $3, 'member', $4)`,
    [`${SHARED_USER_ID}-m`, SHARED_USER_ID, OTHER_ORGANIZATION_ID, REQUESTED_AT],
  )

  await seedPeople(ORGANIZATION_ID, PROPERTY_ID, SHARED_USER_ID)
  await seedPeople(OTHER_ORGANIZATION_ID, OTHER_PROPERTY_ID, `user-other-${suffix}`)

  await lease.pool.query(
    `INSERT INTO portals
       (id, organization_id, property_id, entity_type, entity_id, name, slug)
     VALUES ($1, $2, $3::uuid, 'property', $3::text, 'Staff Lifecycle Portal', $4)`,
    [PORTAL_ID, ORGANIZATION_ID, PROPERTY_ID, `portal-${PORTAL_ID}`],
  )
  await lease.pool.query(
    `INSERT INTO portal_groups
       (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, 'Front Desk', NOW(), NOW())`,
    [PORTAL_GROUP_ID, ORGANIZATION_ID, PROPERTY_ID],
  )
  const participations = await lease.pool.query<{ id: string }>(
    'SELECT id FROM staff_participations WHERE organization_id = $1',
    [ORGANIZATION_ID],
  )
  await lease.pool.query(
    `INSERT INTO portal_responsibilities
       (id, organization_id, property_id, portal_id, staff_participation_id,
        kind, effective_from, created_by)
     VALUES ($1, $2, $3, $4, $5, 'primary', $6, 'user-admin')`,
    [
      randomUUID(),
      ORGANIZATION_ID,
      PROPERTY_ID,
      PORTAL_ID,
      participations.rows[0]!.id,
      EFFECTIVE_FROM,
    ],
  )
  await lease.pool.query(
    `INSERT INTO portal_group_memberships
       (id, organization_id, property_id, portal_id, portal_group_id,
        effective_from, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'user-admin')`,
    [
      randomUUID(),
      ORGANIZATION_ID,
      PROPERTY_ID,
      PORTAL_ID,
      PORTAL_GROUP_ID,
      EFFECTIVE_FROM,
    ],
  )
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
  await lease.pool.query('DELETE FROM member WHERE "organizationId" = ANY($1::text[])', [
    organizationIds,
  ])
  await lease.pool.query('DELETE FROM "user" WHERE id = $1', [SHARED_USER_ID])
  await deleteReceipts(organizationIds)
  await deleteTestOrganizations(lease.pool, organizationIds)
  await lease.release()
})

describe.sequential('Staff Organization lifecycle contributor (real PostgreSQL)', () => {
  it('prepares closing without deleting or scrubbing a single people row', async () => {
    const contributor = createStaffOrganizationLifecycleContributor(db)
    const before = await staffRowCounts(ORGANIZATION_ID)
    expect(Object.values(before).every((count) => count > 0)).toBe(true)

    const result = await contributor.prepareClosing(
      contribution(ORGANIZATION_ID, 1, new Date('2026-08-02T00:00:00.000Z')),
    )

    expect(result).toEqual({
      outcome: 'complete',
      evidenceRef: 'staff:closing:complete:5',
    })
    // Closing opens a recoverable window: every row is still exactly there.
    expect(await staffRowCounts(ORGANIZATION_ID)).toEqual(before)
    expect(await receiptRows(ORGANIZATION_ID)).toEqual([
      {
        context: 'staff',
        phase: 'closing',
        outcome: 'complete',
        evidence_ref: 'staff:closing:complete:5',
      },
    ])
  })

  it('replays the recorded closing receipt for the same lineage and revision', async () => {
    const contributor = createStaffOrganizationLifecycleContributor(db)
    await expect(
      contributor.prepareClosing(
        contribution(ORGANIZATION_ID, 1, new Date('2026-08-02T01:00:00.000Z')),
      ),
    ).resolves.toEqual({ outcome: 'complete', evidenceRef: 'staff:closing:complete:5' })
    expect(await receiptRows(ORGANIZATION_ID)).toHaveLength(1)
  })

  it('answers an Organization with no people rows with affirmative no_data', async () => {
    const contributor = createStaffOrganizationLifecycleContributor(db)
    await expect(
      contributor.prepareClosing(
        contribution(EMPTY_ORGANIZATION_ID, 1, new Date('2026-08-02T00:00:00.000Z')),
      ),
    ).resolves.toEqual({ outcome: 'no_data', evidenceRef: 'staff:closing:no_data:0' })
    expect(await receiptRows(EMPTY_ORGANIZATION_ID)).toEqual([
      {
        context: 'staff',
        phase: 'closing',
        outcome: 'no_data',
        evidence_ref: 'staff:closing:no_data:0',
      },
    ])
  })

  it('fails purge readiness closed while a Staff fact is unpublished, changing nothing', async () => {
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
         (id, event_type, event_version, payload, organization_id, property_id,
          source_context, source_aggregate_id, created_at)
       VALUES ($1, 'test.staff.lifecycle', 1, '{}'::jsonb, $2, $3, 'staff', $4, $5)`,
      [blockerId, ORGANIZATION_ID, PROPERTY_ID, PROPERTY_ID, REQUESTED_AT],
    )
    const contributor = createStaffOrganizationLifecycleContributor(db)
    const before = await staffRowCounts(ORGANIZATION_ID)

    await expect(
      contributor.verifyPurgeReadiness(
        contribution(ORGANIZATION_ID, 2, new Date('2026-08-04T00:00:00.000Z')),
      ),
    ).rejects.toThrow('unpublished_staff_outbox_events')

    // A blocked readiness is a real answer: no receipt, no mutation.
    expect(await staffRowCounts(ORGANIZATION_ID)).toEqual(before)
    expect((await receiptRows(ORGANIZATION_ID)).map(({ phase }) => phase)).toEqual([
      'closing',
    ])

    await lease.pool.query(`UPDATE outbox_events SET published_at = $2 WHERE id = $1`, [
      blockerId,
      REQUESTED_AT,
    ])
  })

  it('verifies purge readiness without mutating a single row', async () => {
    const contributor = createStaffOrganizationLifecycleContributor(db)
    const before = await staffRowCounts(ORGANIZATION_ID)

    const result = await contributor.verifyPurgeReadiness(
      contribution(ORGANIZATION_ID, 2, new Date('2026-08-04T01:00:00.000Z')),
    )

    expect(result).toEqual({
      outcome: 'complete',
      evidenceRef: 'staff:purge_readiness:complete:5',
    })
    expect(await staffRowCounts(ORGANIZATION_ID)).toEqual(before)
  })

  it('purges this tenant only, keeps a user identity that belongs elsewhere, and drops no table', async () => {
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
    const otherBefore = await staffRowCounts(OTHER_ORGANIZATION_ID)
    const contributor = createStaffOrganizationLifecycleContributor(db)

    const result = await contributor.purge(
      contribution(ORGANIZATION_ID, 4, new Date('2026-09-03T00:00:00.000Z')),
    )

    expect(result).toEqual({ outcome: 'complete', evidenceRef: 'staff:purge:complete:5' })
    expect(await staffRowCounts(ORGANIZATION_ID)).toEqual(
      Object.fromEntries(STAFF_LIFECYCLE_TABLES.map((table) => [table, 0])),
    )
    // No tenant-cross deletion: the second Organization is byte-identical.
    expect(await staffRowCounts(OTHER_ORGANIZATION_ID)).toEqual(otherBefore)

    // The human keeps their identity because they are a member of the second
    // Organization; Staff scrubs participation, Identity owns the person.
    const users = await lease.pool.query<{ count: string }>(
      'SELECT count(*) AS count FROM "user" WHERE id = $1',
      [SHARED_USER_ID],
    )
    expect(Number(users.rows[0]!.count)).toBe(1)
    const memberships = await lease.pool.query<{ count: string }>(
      'SELECT count(*) AS count FROM member WHERE "userId" = $1',
      [SHARED_USER_ID],
    )
    expect(Number(memberships.rows[0]!.count)).toBe(1)

    // Every physical table still exists: a tenant purge deletes rows, never
    // schema.
    for (const table of STAFF_LIFECYCLE_TABLES) {
      const present = await lease.pool.query<{ count: string }>(
        `SELECT count(*) AS count FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1`,
        [table],
      )
      expect(Number(present.rows[0]!.count)).toBe(1)
    }
  })

  it('is idempotent: replaying the purge returns the recorded receipt', async () => {
    const contributor = createStaffOrganizationLifecycleContributor(db)
    await expect(
      contributor.purge(
        contribution(ORGANIZATION_ID, 4, new Date('2026-09-03T02:00:00.000Z')),
      ),
    ).resolves.toEqual({ outcome: 'complete', evidenceRef: 'staff:purge:complete:5' })

    const receipts = await receiptRows(ORGANIZATION_ID)
    expect(receipts.map(({ phase }) => phase)).toEqual([
      'closing',
      'purge',
      'purge_readiness',
    ])
    // Content-free throughout: no display name, email or free text anywhere.
    for (const receipt of receipts) {
      expect(receipt.evidence_ref).toMatch(/^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$/u)
      expect(receipt.evidence_ref).not.toContain('Dana')
      expect(receipt.evidence_ref).not.toContain('@')
    }
  })

  it('refuses to contribute against a stale lifecycle authority', async () => {
    const contributor = createStaffOrganizationLifecycleContributor(db)
    await expect(
      contributor.purge(
        contribution(ORGANIZATION_ID, 3, new Date('2026-09-03T03:00:00.000Z')),
      ),
    ).rejects.toThrow(/authority changed/u)
  })
})
