// LIF-01-T12/T13/T14 — Metric lifecycle contributor against real PostgreSQL.
//
// The unit test proves the decision logic. Only a real schema can prove what
// an operator relies on: Closing deletes nothing, readiness mutates nothing
// and really does fail closed on LIF-01 bullet 11's ordering, and purge
// removes this tenant's rows — including the tenant-identified anonymous
// lifetime aggregate — while leaving every other tenant byte-identical.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  createMetricOrganizationLifecycleAdapter,
  METRIC_PURGE_TABLES,
} from './metric-organization-lifecycle.adapter'

// Immutable registry ids seeded by migration 0018 (METRIC_VERSION_IDS).
const RATING_COUNT_GOAL_VERSION = '11111111-1111-4111-8111-111111111302'
const PROPERTY_REVIEW_DASHBOARD_VERSION = '11111111-1111-4111-8111-111111111205'

const organizations = new Set<string>()
let lease: TestLease
let db: Database

const REQUESTED_AT = new Date('2026-08-01T00:00:00.000Z')
const RECOVERABLE_UNTIL = new Date('2026-08-31T00:00:00.000Z')
const OCCURRED_AT = new Date('2026-09-01T00:00:00.000Z')

type Fixture = Readonly<{
  organizationId: string
  closureLineageId: string
  propertyId: string
  /** Carries the lifetime aggregate; deliberately has no portal-scoped reading. */
  aggregatePortalId: string
  /** Carries portal-scoped readings; deliberately has no aggregate row. */
  readingPortalId: string
  readingId: string
}>

async function seedOrganization(prefix: string): Promise<string> {
  const organizationId = `${prefix}-${randomUUID()}`
  organizations.add(organizationId)
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Metric Lifecycle Fixture', $1, $2)`,
    [organizationId, REQUESTED_AT],
  )
  return organizationId
}

async function seedTenantRows(prefix: string): Promise<Fixture> {
  const organizationId = await seedOrganization(prefix)
  const fixture: Fixture = {
    organizationId,
    closureLineageId: randomUUID(),
    propertyId: randomUUID(),
    aggregatePortalId: randomUUID(),
    readingPortalId: randomUUID(),
    readingId: randomUUID(),
  }

  await lease.pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1::uuid, $2, 'Metric Lifecycle Property', $1::text, 'UTC', $3, $3)`,
    [fixture.propertyId, organizationId, REQUESTED_AT],
  )
  for (const portal of [fixture.aggregatePortalId, fixture.readingPortalId]) {
    await lease.pool.query(
      `INSERT INTO portals (
         id, organization_id, property_id, entity_type, entity_id, name, slug,
         created_at, updated_at
       ) VALUES ($1::uuid, $2, $3::uuid, 'property', $3::text, 'Metric Lifecycle Portal',
                 $1::text, $4, $4)`,
      [portal, organizationId, fixture.propertyId, REQUESTED_AT],
    )
  }

  // One property-level reading and one portal-scoped reading on the portal
  // that carries no lifetime aggregate, so the aggregate stays reconciled.
  await lease.pool.query(
    `INSERT INTO metric_readings (
       id, organization_id, property_id, portal_id, metric_key, value,
       definition_version_id, source_event_id, source_policy, exact_value,
       sample_count, attribution_quality, recorded_at, event_at,
       property_local_date, data_quality, retention_class
     ) VALUES ($1::uuid, $2, $3::uuid, NULL, 'property.review', 5::real,
               $4, $5, 'google_property_derivative', 5::numeric, 1, 'exact',
               $6, $6, '2026-08-01', 'exact', 'guest_gateway_metric')`,
    [
      fixture.readingId,
      organizationId,
      fixture.propertyId,
      PROPERTY_REVIEW_DASHBOARD_VERSION,
      `metric-lifecycle-${fixture.readingId}`,
      REQUESTED_AT,
    ],
  )
  const portalReadingId = randomUUID()
  await lease.pool.query(
    `INSERT INTO metric_readings (
       id, organization_id, property_id, portal_id, metric_key, value,
       definition_version_id, source_event_id, source_policy, exact_value,
       sample_count, attribution_quality, recorded_at, event_at,
       property_local_date, data_quality, retention_class
     ) VALUES ($1::uuid, $2, $3::uuid, $4::uuid, 'portal.rating_count', 1::real,
               $5, $6, 'first_party_guest_gateway_metric', 1::numeric, 1, 'exact',
               $7, $7, '2026-08-01', 'exact', 'guest_gateway_metric')`,
    [
      portalReadingId,
      organizationId,
      fixture.propertyId,
      fixture.readingPortalId,
      RATING_COUNT_GOAL_VERSION,
      `metric-lifecycle-portal-${portalReadingId}`,
      REQUESTED_AT,
    ],
  )

  // A two-link supersession chain: the flat DELETE a naive plan would issue
  // is refused by ON DELETE RESTRICT, so this exercises the tip-first drain.
  const rootCorrectionId = randomUUID()
  const headCorrectionId = randomUUID()
  await lease.pool.query(
    `INSERT INTO metric_corrections (
       id, reading_id, source_event_id, kind, reason, actor_type, actor_id,
       exact_delta, event_at, recorded_at
     ) VALUES ($1::uuid, $2::uuid, $3, 'adjust', 'lifecycle fixture', 'system',
               'system:test', 1::numeric, $4, $4)`,
    [
      rootCorrectionId,
      fixture.readingId,
      `correction-root-${rootCorrectionId}`,
      REQUESTED_AT,
    ],
  )
  await lease.pool.query(
    `INSERT INTO metric_corrections (
       id, reading_id, source_event_id, kind, reason, actor_type, actor_id,
       replacement_value, supersedes_correction_id, event_at, recorded_at
     ) VALUES ($1::uuid, $2::uuid, $3, 'replace', 'lifecycle fixture', 'system',
               'system:test', 4::numeric, $4::uuid, $5, $5)`,
    [
      headCorrectionId,
      fixture.readingId,
      `correction-head-${headCorrectionId}`,
      rootCorrectionId,
      REQUESTED_AT,
    ],
  )

  await lease.pool.query(
    `INSERT INTO metric_current_google_reputation_snapshots (
       property_id, organization_id, source_epoch, source_run_id, source_event_id,
       review_count, average_rating, evaluated_at, updated_at
     ) VALUES ($1::uuid, $2, 1, gen_random_uuid(), gen_random_uuid(), 12, 4.5, $3, $3)`,
    [fixture.propertyId, organizationId, REQUESTED_AT],
  )
  // Reconciled by construction: zero totals with no retained portal fact.
  await lease.pool.query(
    `INSERT INTO portal_metric_lifetime_aggregates
       (id, organization_id, property_id, portal_id, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2::uuid, $3::uuid, $4, $4)`,
    [organizationId, fixture.propertyId, fixture.aggregatePortalId, REQUESTED_AT],
  )

  return fixture
}

async function requestClosure(fixture: Fixture): Promise<void> {
  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
     SET state = 'closure_requested', revision = revision + 1,
         closure_lineage_id = $2, closure_requested_at = $3,
         recoverable_until = $4, reactivation_required = true,
         requested_by = 'admin:metric-lifecycle-test',
         request_reason_code = 'test_workspace',
         request_support_evidence_ref = 'test:closure-request',
         last_transition_at = $3, last_actor_id = 'admin:metric-lifecycle-test',
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
         last_transition_at = $3, last_actor_id = 'system:metric-lifecycle-test',
         last_reason_code = $4, last_support_evidence_ref = 'test:advance'
     WHERE organization_id = $1`,
    [organizationId, to, REQUESTED_AT, reasonCode],
  )
}

/** Exact per-table counts for the reviewed tenant purge plan. */
async function tableCounts(
  organizationId: string,
): Promise<Readonly<Record<string, number>>> {
  const counts: Record<string, number> = {}
  for (const table of METRIC_PURGE_TABLES) {
    const scoped =
      table === 'metric_corrections'
        ? `SELECT count(*)::int AS count FROM metric_corrections c
           JOIN metric_readings r ON r.id = c.reading_id WHERE r.organization_id = $1`
        : `SELECT count(*)::int AS count FROM ${table} WHERE organization_id = $1`
    const result = await lease.pool.query(scoped, [organizationId])
    counts[table] = (result.rows[0] as { count: number }).count
  }
  return counts
}

async function receipts(organizationId: string) {
  const result = await lease.pool.query(
    `SELECT phase, payload->>'outcome' AS outcome,
            payload->>'evidenceRef' AS evidence_ref
     FROM organization_lifecycle_events
     WHERE organization_id = $1 AND context = 'metric'
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

describe.sequential('metric Organization lifecycle contributor', () => {
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
        `DELETE FROM metric_corrections
         WHERE reading_id IN (SELECT id FROM metric_readings WHERE organization_id = $1)
           AND supersedes_correction_id IS NOT NULL`,
        [organizationId],
      )
      await lease.pool.query(
        `DELETE FROM metric_corrections
         WHERE reading_id IN (SELECT id FROM metric_readings WHERE organization_id = $1)`,
        [organizationId],
      )
      for (const table of METRIC_PURGE_TABLES) {
        if (table === 'metric_corrections') continue
        await lease.pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [
          organizationId,
        ])
      }
      await lease.pool.query('DELETE FROM portals WHERE organization_id = $1', [
        organizationId,
      ])
      await lease.pool.query('DELETE FROM properties WHERE organization_id = $1', [
        organizationId,
      ])
    }
    await deleteReceiptFixtures([...organizations])
    await deleteTestOrganizations(lease.pool, [...organizations])
    organizations.clear()
  })

  it('prepareClosing deletes nothing and records one content-free receipt', async () => {
    const fixture = await seedTenantRows('metric-lifecycle-org')
    await requestClosure(fixture)
    const before = await tableCounts(fixture.organizationId)

    const contributor = createMetricOrganizationLifecycleAdapter(db)
    const result = await contributor.prepareClosing(contribution(fixture, 1))

    expect(result.outcome).toBe('complete')
    // Closing opens a recoverable window: every row survives it.
    expect(await tableCounts(fixture.organizationId)).toEqual(before)
    const persisted = await receipts(fixture.organizationId)
    expect(persisted).toHaveLength(1)
    expect(persisted[0]!.phase).toBe('closing')
    expect(persisted[0]!.evidence_ref).toMatch(
      /^metric:closing:v1:no_context_owned_effect:\d+$/u,
    )
    expect(persisted[0]!.evidence_ref).not.toContain(fixture.organizationId)
  })

  it('verifyPurgeReadiness mutates nothing when the lifetime aggregate is reconciled', async () => {
    const fixture = await seedTenantRows('metric-lifecycle-org')
    await requestClosure(fixture)
    await advance(fixture.organizationId, 'closing', 'closing_prepared')
    const before = await tableCounts(fixture.organizationId)
    const aggregateBefore = await lease.pool.query(
      `SELECT * FROM portal_metric_lifetime_aggregates WHERE organization_id = $1`,
      [fixture.organizationId],
    )

    const contributor = createMetricOrganizationLifecycleAdapter(db)
    const result = await contributor.verifyPurgeReadiness(contribution(fixture, 2))

    expect(result.outcome).toBe('complete')
    expect(await tableCounts(fixture.organizationId)).toEqual(before)
    const aggregateAfter = await lease.pool.query(
      `SELECT * FROM portal_metric_lifetime_aggregates WHERE organization_id = $1`,
      [fixture.organizationId],
    )
    expect(aggregateAfter.rows).toEqual(aggregateBefore.rows)
  })

  it('verifyPurgeReadiness fails closed when a correction has not reached the lifetime aggregate', async () => {
    const fixture = await seedTenantRows('metric-lifecycle-org')
    await requestClosure(fixture)
    await advance(fixture.organizationId, 'closing', 'closing_prepared')
    // LIF-01 bullet 11: the anonymous total no longer matches its retained
    // facts, so the irreversible boundary would freeze a wrong number.
    await lease.pool.query(
      `UPDATE portal_metric_lifetime_aggregates
       SET qualified_scan_count = 7
       WHERE organization_id = $1`,
      [fixture.organizationId],
    )
    const before = await tableCounts(fixture.organizationId)

    const contributor = createMetricOrganizationLifecycleAdapter(db)
    await expect(
      contributor.verifyPurgeReadiness(contribution(fixture, 2)),
    ).rejects.toThrow(/readiness blocked/u)

    // A blocked answer stops the coordinator without a receipt or a mutation.
    expect(await receipts(fixture.organizationId)).toEqual([])
    expect(await tableCounts(fixture.organizationId)).toEqual(before)
  })

  it('purge removes this tenant only and is idempotent', async () => {
    const fixture = await seedTenantRows('metric-lifecycle-org')
    const bystander = await seedTenantRows('metric-lifecycle-bystander')
    await requestClosure(fixture)
    await advance(fixture.organizationId, 'closing', 'closing_prepared')
    await advance(fixture.organizationId, 'purge_pending', 'recovery_window_elapsed')
    await advance(fixture.organizationId, 'purging', 'irreversible_purge_authorized')
    const bystanderBefore = await tableCounts(bystander.organizationId)

    const contributor = createMetricOrganizationLifecycleAdapter(db)
    const first = await contributor.purge(contribution(fixture, 4))
    const replay = await contributor.purge(contribution(fixture, 4))

    expect(first.outcome).toBe('complete')
    expect(replay).toEqual(first)

    const after = await tableCounts(fixture.organizationId)
    for (const table of METRIC_PURGE_TABLES) {
      expect({ table, count: after[table] }).toEqual({ table, count: 0 })
    }
    // No tenant-cross deletion.
    expect(await tableCounts(bystander.organizationId)).toEqual(bystanderBefore)

    const persisted = await receipts(fixture.organizationId)
    expect(persisted).toHaveLength(1)
    expect(persisted[0]!.phase).toBe('purge')
    expect(persisted[0]!.outcome).toBe('complete')
    expect(persisted[0]!.evidence_ref).toMatch(
      /^metric:purge:v1:tenant_rows_deleted:\d+$/u,
    )
  })

  it('answers no_data — never an omission — for an Organization with no metric row', async () => {
    const fixture: Fixture = {
      organizationId: await seedOrganization('metric-lifecycle-empty'),
      closureLineageId: randomUUID(),
      propertyId: randomUUID(),
      aggregatePortalId: randomUUID(),
      readingPortalId: randomUUID(),
      readingId: randomUUID(),
    }
    await requestClosure(fixture)
    const contributor = createMetricOrganizationLifecycleAdapter(db)

    await expect(contributor.prepareClosing(contribution(fixture, 1))).resolves.toEqual({
      outcome: 'no_data',
      evidenceRef: 'metric:closing:v1:no_context_owned_effect:0',
    })
    await advance(fixture.organizationId, 'closing', 'closing_prepared')
    await expect(
      contributor.verifyPurgeReadiness(contribution(fixture, 2)),
    ).resolves.toEqual({
      outcome: 'no_data',
      evidenceRef: 'metric:purge_readiness:v1:lifetime_parity_verified:0',
    })
    await advance(fixture.organizationId, 'purge_pending', 'recovery_window_elapsed')
    await advance(fixture.organizationId, 'purging', 'irreversible_purge_authorized')
    await expect(contributor.purge(contribution(fixture, 4))).resolves.toEqual({
      outcome: 'no_data',
      evidenceRef: 'metric:purge:v1:nothing_to_scrub:0',
    })

    expect((await receipts(fixture.organizationId)).map((row) => row.outcome)).toEqual([
      'no_data',
      'no_data',
      'no_data',
    ])
  })

  it('refuses to contribute when the live authority is not in this phase', async () => {
    const fixture = await seedTenantRows('metric-lifecycle-stale')
    await requestClosure(fixture)
    const before = await tableCounts(fixture.organizationId)

    const contributor = createMetricOrganizationLifecycleAdapter(db)
    await expect(contributor.purge(contribution(fixture, 1))).rejects.toThrow(
      /authority changed/u,
    )

    expect(await tableCounts(fixture.organizationId)).toEqual(before)
    expect(await receipts(fixture.organizationId)).toEqual([])
  })
})
