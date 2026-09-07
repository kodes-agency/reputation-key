// LIF-01-T12/T13/T14 — Property lifecycle contribution against real
// PostgreSQL.
//
// Only a real schema can prove what an operator has to trust:
//   * Closing suspends new provider work and DELETES NOTHING — the Google
//     binding, the review destination and the managerial history survive;
//   * purge readiness MUTATES NOTHING and fails closed while a Property still
//     admits provider work;
//   * purge empties the Property plan for one Organization, leaves a second
//     Organization byte-identical, and refuses rather than cascading while
//     another context still references the Property.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import type { OrganizationLifecycleContributionInput } from '#/contexts/identity/application/ports/organization-lifecycle-contributor.port'
import {
  PROPERTY_PURGE_PLAN,
  PROPERTY_PURGE_READINESS_BLOCKED,
  createPropertyOrganizationLifecycleContributor,
  propertyClosingLifecycleReason,
} from './property-organization-lifecycle.adapter'

const organizations = new Set<string>()
let lease: TestLease
let db: Database

const OCCURRED_AT = new Date('2027-01-15T00:00:00.000Z')
const RECOVERABLE_UNTIL = new Date('2027-02-14T00:00:00.000Z')

const OBSERVED_TABLES = [...PROPERTY_PURGE_PLAN] as const

type Fixture = Readonly<{
  organizationId: string
  activePropertyId: string
  archivedPropertyId: string
}>

async function counts(organizationId: string): Promise<Record<string, number>> {
  const entries = await Promise.all(
    OBSERVED_TABLES.map(async (table) => {
      const result =
        table === 'idempotency_receipts'
          ? await lease.pool.query(
              `SELECT COUNT(*)::int AS count FROM idempotency_receipts
               WHERE scope = 'property_operation'
                 AND payload->>'organizationId' = $1`,
              [organizationId],
            )
          : await lease.pool.query(
              `SELECT COUNT(*)::int AS count FROM ${table} WHERE organization_id = $1`,
              [organizationId],
            )
      return [table, Number(result.rows[0]?.count ?? 0)] as const
    }),
  )
  return Object.fromEntries(entries)
}

async function seedOrganization(): Promise<string> {
  const organizationId = `property-lifecycle-org-${randomUUID()}`
  organizations.add(organizationId)
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Property Lifecycle Fixture', $1, now())`,
    [organizationId],
  )
  return organizationId
}

async function seedFixture(): Promise<Fixture> {
  const organizationId = await seedOrganization()
  const fixture: Fixture = {
    organizationId,
    activePropertyId: randomUUID(),
    archivedPropertyId: randomUUID(),
  }
  const actor = `property-lifecycle-actor-${randomUUID()}`
  const q = (text: string, values: readonly unknown[]) =>
    lease.pool.query(text, [...values])

  await q(
    `INSERT INTO properties (id, organization_id, name, slug, timezone,
                             lifecycle_state, created_at, updated_at)
     VALUES ($1, $2, 'Harbour House', 'harbour-house', 'UTC', 'active', now(), now())`,
    [fixture.activePropertyId, organizationId],
  )
  // A Property the tenant archived on its own. Closing must leave its state
  // and its own recovery deadline alone.
  await q(
    `INSERT INTO properties (id, organization_id, name, slug, timezone,
                             lifecycle_state, lifecycle_reason, created_at, updated_at)
     VALUES ($1, $2, 'Old Wing', 'old-wing', 'UTC', 'archived', 'tenant_archive',
             now(), now())`,
    [fixture.archivedPropertyId, organizationId],
  )
  await q(
    `INSERT INTO property_responsible_managers (
       id, organization_id, property_id, user_id, effective_from, created_by
     ) VALUES ($1, $2, $3, $4, now(), $4)`,
    [randomUUID(), organizationId, fixture.activePropertyId, actor],
  )
  await q(
    `INSERT INTO idempotency_receipts (scope, key, payload, recorded_at)
     VALUES ('property_operation', $1, jsonb_build_object(
       'organizationId', $2::text,
       'destinationPropertyId', $3::text,
       'outcome', 'imported',
       'tombstone', false
     ), now())`,
    [randomUUID(), organizationId, fixture.activePropertyId],
  )
  return fixture
}

async function seedAuthority(
  organizationId: string,
  lineage: string,
  target: 'closure_requested' | 'closing' | 'purging',
): Promise<number> {
  const requestAt = new Date(OCCURRED_AT.getTime() - 5000)
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
    [organizationId, lineage, requestAt, RECOVERABLE_UNTIL],
  )
  if (target === 'closure_requested') return 1

  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
     SET state = 'closing', revision = 2, last_transition_at = $2,
         last_actor_id = 'system:lifecycle', last_reason_code = 'closing_prepared',
         last_support_evidence_ref = 'test:closing-prepared'
     WHERE organization_id = $1`,
    [organizationId, new Date(OCCURRED_AT.getTime() - 4000)],
  )
  if (target === 'closing') return 2

  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
     SET state = 'purge_pending', revision = 3, last_transition_at = $2,
         last_actor_id = 'support:lifecycle-test',
         last_reason_code = 'recovery_window_waived',
         last_support_evidence_ref = 'test:recovery-waived'
     WHERE organization_id = $1`,
    [organizationId, new Date(OCCURRED_AT.getTime() - 3000)],
  )
  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
     SET state = 'purging', revision = 4, irreversible_at = $2,
         last_transition_at = $2, last_actor_id = 'support:lifecycle-test',
         last_reason_code = 'irreversible_purge_authorized',
         last_support_evidence_ref = 'test:purge-authorized'
     WHERE organization_id = $1`,
    [organizationId, new Date(OCCURRED_AT.getTime() - 2000)],
  )
  return 4
}

function input(
  organizationId: string,
  lineage: string,
  revision: number,
): OrganizationLifecycleContributionInput {
  return {
    organizationId,
    closureLineageId: lineage,
    lifecycleRevision: revision,
    recoverableUntil: RECOVERABLE_UNTIL,
    occurredAt: OCCURRED_AT,
  }
}

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

const CLEANUP_ORDER = ['portals', 'property_responsible_managers', 'properties'] as const

describe.sequential('Property Organization lifecycle contributor', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    db = drizzle(lease.pool) as Database
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    const ids = [...organizations]
    await lease.pool.query(
      `DELETE FROM idempotency_receipts
       WHERE scope = 'property_operation' AND payload->>'organizationId' = ANY($1::text[])`,
      [ids],
    )
    for (const table of CLEANUP_ORDER) {
      await lease.pool.query(
        `DELETE FROM ${table} WHERE organization_id = ANY($1::text[])`,
        [ids],
      )
    }
    await deleteReceiptFixtures(ids)
    await deleteTestOrganizations(lease.pool, ids)
    organizations.clear()
  })

  it('suspends provider admission on Closing and deletes nothing', async () => {
    const fixture = await seedFixture()
    const lineage = randomUUID()
    const revision = await seedAuthority(
      fixture.organizationId,
      lineage,
      'closure_requested',
    )
    const before = await counts(fixture.organizationId)

    const result = await createPropertyOrganizationLifecycleContributor(
      db,
    ).prepareClosing(input(fixture.organizationId, lineage, revision))

    expect(result).toEqual({
      outcome: 'complete',
      evidenceRef: `property:closing:complete:${lineage}:r${revision}`,
    })
    // Nothing was deleted. Closing opens a recoverable window.
    expect(await counts(fixture.organizationId)).toEqual(before)

    const rows = await lease.pool.query(
      `SELECT id, lifecycle_state, lifecycle_reason, lifecycle_initiated_by,
              lifecycle_state_changed_at, deleted_at
       FROM properties WHERE organization_id = $1 ORDER BY slug`,
      [fixture.organizationId],
    )
    const byId = new Map(rows.rows.map((row) => [row.id, row]))
    // The active Property is withdrawn from provider work, and the closure
    // lineage is stamped so explicit reactivation can restore exactly this set.
    expect(byId.get(fixture.activePropertyId)).toMatchObject({
      lifecycle_state: 'suspended',
      lifecycle_reason: propertyClosingLifecycleReason(lineage),
      lifecycle_initiated_by: 'system:organization-lifecycle',
      lifecycle_state_changed_at: OCCURRED_AT,
      deleted_at: null,
    })
    // A Property the tenant archived itself keeps its own state and reason, so
    // cancelling the closure cannot silently un-archive it.
    expect(byId.get(fixture.archivedPropertyId)).toMatchObject({
      lifecycle_state: 'archived',
      lifecycle_reason: 'tenant_archive',
    })

    const receipt = await lease.pool.query(
      `SELECT context, phase, outcome, evidence_ref
       FROM context_organization_lifecycle_receipts WHERE organization_id = $1`,
      [fixture.organizationId],
    )
    expect(receipt.rows).toEqual([
      {
        context: 'property',
        phase: 'closing',
        outcome: 'complete',
        evidence_ref: `property:closing:complete:${lineage}:r${revision}`,
      },
    ])
  })

  it('answers no_data for an Organization that owns no Property', async () => {
    const organizationId = await seedOrganization()
    const lineage = randomUUID()
    const revision = await seedAuthority(organizationId, lineage, 'closure_requested')

    const result = await createPropertyOrganizationLifecycleContributor(
      db,
    ).prepareClosing(input(organizationId, lineage, revision))

    expect(result).toEqual({
      outcome: 'no_data',
      evidenceRef: `property:closing:no_data:${lineage}:r${revision}`,
    })
  })

  it('fails closed on readiness while a Property still admits provider work', async () => {
    const fixture = await seedFixture()
    const lineage = randomUUID()
    const revision = await seedAuthority(fixture.organizationId, lineage, 'closing')
    const contributor = createPropertyOrganizationLifecycleContributor(db)
    const before = await counts(fixture.organizationId)

    await expect(
      contributor.verifyPurgeReadiness(input(fixture.organizationId, lineage, revision)),
    ).rejects.toThrow(PROPERTY_PURGE_READINESS_BLOCKED)

    expect(await counts(fixture.organizationId)).toEqual(before)
    const receipts = await lease.pool.query(
      `SELECT COUNT(*)::int AS count FROM context_organization_lifecycle_receipts
       WHERE organization_id = $1`,
      [fixture.organizationId],
    )
    expect(Number(receipts.rows[0]?.count)).toBe(0)

    // With the closing fence in place the same read-only pass succeeds and
    // still changes no row anywhere in the context.
    await lease.pool.query(
      `UPDATE properties SET lifecycle_state = 'suspended'
       WHERE organization_id = $1 AND lifecycle_state = 'active'`,
      [fixture.organizationId],
    )
    const fenced = await counts(fixture.organizationId)
    const snapshot = await lease.pool.query(
      `SELECT id, lifecycle_state, name, gbp_location_id FROM properties
       WHERE organization_id = $1 ORDER BY id`,
      [fixture.organizationId],
    )

    const result = await contributor.verifyPurgeReadiness(
      input(fixture.organizationId, lineage, revision),
    )

    expect(result).toEqual({
      outcome: 'complete',
      evidenceRef: `property:purge_readiness:complete:${lineage}:r${revision}`,
    })
    expect(await counts(fixture.organizationId)).toEqual(fenced)
    const afterSnapshot = await lease.pool.query(
      `SELECT id, lifecycle_state, name, gbp_location_id FROM properties
       WHERE organization_id = $1 ORDER BY id`,
      [fixture.organizationId],
    )
    expect(afterSnapshot.rows).toEqual(snapshot.rows)
  })

  it('empties every planned table for one Organization and leaves another untouched', async () => {
    const fixture = await seedFixture()
    const bystander = await seedFixture()
    const lineage = randomUUID()
    const revision = await seedAuthority(fixture.organizationId, lineage, 'purging')
    const bystanderBefore = await counts(bystander.organizationId)
    const contributor = createPropertyOrganizationLifecycleContributor(db)

    const first = await contributor.purge(
      input(fixture.organizationId, lineage, revision),
    )

    expect(first).toEqual({
      outcome: 'complete',
      evidenceRef: `property:purge:complete:${lineage}:r${revision}`,
    })
    const after = await counts(fixture.organizationId)
    for (const table of PROPERTY_PURGE_PLAN) {
      expect({ table, rows: after[table] }).toEqual({ table, rows: 0 })
    }
    expect(await counts(bystander.organizationId)).toEqual(bystanderBefore)

    const replay = await contributor.purge({
      ...input(fixture.organizationId, lineage, revision),
      occurredAt: new Date(OCCURRED_AT.getTime() + 60_000),
    })
    expect(replay).toEqual(first)
    expect(await counts(fixture.organizationId)).toEqual(after)

    const present = await lease.pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [[...PROPERTY_PURGE_PLAN]],
    )
    expect(present.rows.map((row) => row.table_name).sort()).toEqual(
      [...PROPERTY_PURGE_PLAN].sort(),
    )
  })

  it('refuses rather than cascading while another context still holds the Property', async () => {
    const fixture = await seedFixture()
    const lineage = randomUUID()
    const revision = await seedAuthority(fixture.organizationId, lineage, 'purging')
    // Portal supplies its own purge receipt. Until it has, the Property delete
    // must fail rather than remove another owner's rows.
    await lease.pool.query(
      `INSERT INTO portals (id, organization_id, property_id, entity_id, name, slug,
                            publication_state, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Front Desk', 'front-desk', 'draft', now(), now())`,
      [
        randomUUID(),
        fixture.organizationId,
        fixture.activePropertyId,
        fixture.activePropertyId,
      ],
    )

    await expect(
      createPropertyOrganizationLifecycleContributor(db).purge(
        input(fixture.organizationId, lineage, revision),
      ),
      // Postgres 23503 by code, on the driver error Drizzle wraps. The code IS
      // the claim: the delete must be REFUSED by the Portal foreign key, not
      // fail for some unrelated reason an unnamed assertion would accept.
    ).rejects.toMatchObject({ cause: { code: '23503' } })

    // The whole phase rolled back: no receipt, and no partially scrubbed rows.
    const state = await lease.pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM properties WHERE organization_id = $1) AS properties,
         (SELECT COUNT(*)::int FROM idempotency_receipts
          WHERE scope = 'property_operation'
            AND payload->>'organizationId' = $1) AS receipts,
         (SELECT COUNT(*)::int FROM property_responsible_managers
          WHERE organization_id = $1) AS managers,
         (SELECT COUNT(*)::int FROM context_organization_lifecycle_receipts
          WHERE organization_id = $1) AS lifecycle_receipts`,
      [fixture.organizationId],
    )
    expect(state.rows[0]).toEqual({
      properties: 2,
      receipts: 1,
      managers: 1,
      lifecycle_receipts: 0,
    })
  })
})
