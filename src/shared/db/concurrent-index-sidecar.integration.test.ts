// Real-Postgres coverage for the autocommit sidecar (database-03,
// database-04). Every query here runs WITHOUT an explicit transaction:
// `CREATE INDEX CONCURRENTLY` is refused inside one, so unlike most
// integration tests in this repo this file cannot isolate itself with
// BEGIN/ROLLBACK. Cleanup is explicit DELETE/DROP instead, mirroring the
// retired google-property-binding-index.integration.test.ts, which had the
// same constraint.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { buildConcurrentIndex } from './concurrent-index-sidecar'
import { CONCURRENT_INDEX_REGISTRY } from './concurrent-index-registry'

function specFor(name: string): (typeof CONCURRENT_INDEX_REGISTRY)[number] {
  const spec = CONCURRENT_INDEX_REGISTRY.find((candidate) => candidate.name === name)
  if (!spec) throw new Error(`${name} not registered in concurrent-index-registry.ts`)
  return spec
}

const SPEC = specFor('review_provider_snapshot_runs_completed_property_idx')
const METRIC_PROPERTY_SPEC = specFor('metric_readings_property_idx')
const METRIC_PORTAL_SPEC = specFor('metric_readings_portal_only_idx')
const METRIC_GROUP_SPEC = specFor('metric_readings_group_only_idx')

type IndexCatalogRow = Readonly<{
  indexdef: string
  indisvalid: boolean
  indisready: boolean
}>

// The index as PostgreSQL recorded it. Asserting the catalogue rather than an
// EXPLAIN plan keeps these tests deterministic: on a table holding a couple of
// test rows the planner's choice depends on statistics, not on whether the
// index exists (CI chose another path and failed an earlier plan-shape
// version of this test).
async function readIndex(
  pool: TestLease['pool'],
  name: string,
): Promise<IndexCatalogRow | null> {
  const result = await pool.query<IndexCatalogRow>(
    `SELECT pg_get_indexdef(x.indexrelid) AS indexdef, x.indisvalid, x.indisready
       FROM pg_index x
       JOIN pg_class c ON c.oid = x.indexrelid
      WHERE c.relname = $1`,
    [name],
  )
  return result.rows[0] ?? null
}

describe('review_provider_snapshot_runs completed-property index sidecar', () => {
  let lease: TestLease
  let organizationId: string
  let propertyId: string

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
  })

  afterAll(async () => {
    await lease.pool.query(
      'DELETE FROM review_provider_snapshot_runs WHERE organization_id = $1',
      [organizationId],
    )
    await lease.pool.query('DELETE FROM properties WHERE organization_id = $1', [
      organizationId,
    ])
    await lease?.release()
  })

  it('builds the index concurrently, serves the completed-run lookup by index, and excludes nonterminal rows', async () => {
    organizationId = `org-snapshot-idx-${randomUUID()}`
    propertyId = randomUUID()
    const completedRunId = randomUUID()
    const scanningRunId = randomUUID()

    await lease.pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Snapshot index test', $3, 'UTC')`,
      [propertyId, organizationId, `snapshot-index-${propertyId}`],
    )

    // One completed run (what the index must serve) and one still-scanning
    // run for the same organization/property/epoch (already covered by the
    // sibling nonterminal partial unique index, and must NOT match this one).
    await lease.pool.query(
      `INSERT INTO review_provider_snapshot_runs (
         id, organization_id, property_id, source_epoch, state, phase,
         started_at, expires_at, terminal_at, record_expires_at
       ) VALUES
         ($1, $2, $3, 1, 'completed', 'terminal', now(), now() + interval '1 day', now(), now() + interval '30 days'),
         ($4, $2, $3, 2, 'scanning', 'main', now(), now() + interval '1 day', NULL, NULL)`,
      [completedRunId, organizationId, propertyId, scanningRunId],
    )

    // Idempotent by name: leave no stale index from a previous failed run.
    await lease.pool.query(`DROP INDEX CONCURRENTLY IF EXISTS "${SPEC.name}"`)

    const built = await buildConcurrentIndex(lease.pool, SPEC)
    expect(built).toEqual({ name: SPEC.name, ok: true, code: 'created' })

    const rerun = await buildConcurrentIndex(lease.pool, SPEC)
    expect(rerun).toEqual({ name: SPEC.name, ok: true, code: 'ready' })

    // Functional correctness: the completed run's property_id comes back;
    // the scanning run's does not.
    const rows = await lease.pool.query<{ property_id: string }>(
      `SELECT property_id FROM review_provider_snapshot_runs
        WHERE organization_id = $1 AND state = 'completed'`,
      [organizationId],
    )
    expect(rows.rows).toEqual([{ property_id: propertyId }])

    // Catalogue shape: property-setup.repository.ts's synced_properties CTE
    // filters on (organization_id, state = 'completed'); the index must lead
    // with organization_id and be partial on the completed state, and the
    // CONCURRENTLY build must have left it valid and ready.
    const index = await readIndex(lease.pool, SPEC.name)
    expect(index).toMatchObject({ indisvalid: true, indisready: true })
    expect(index?.indexdef).toMatch(/\(organization_id, property_id, source_epoch\)/)
    expect(index?.indexdef).toMatch(/WHERE .*state.*'completed'/)
  })
})

describe('metric_readings property/portal/group index sidecar (database-04)', () => {
  let lease: TestLease
  let organizationId: string
  let propertyId: string
  let portalId: string
  let groupId: string

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
  })

  afterAll(async () => {
    await lease.pool.query('DELETE FROM metric_readings WHERE organization_id = $1', [
      organizationId,
    ])
    await lease.pool.query('DELETE FROM portal_groups WHERE organization_id = $1', [
      organizationId,
    ])
    await lease.pool.query('DELETE FROM portals WHERE organization_id = $1', [
      organizationId,
    ])
    await lease.pool.query('DELETE FROM properties WHERE organization_id = $1', [
      organizationId,
    ])
    await lease?.release()
  })

  it('builds all three indexes concurrently and serves each single-column FK lookup by index', async () => {
    organizationId = `org-metric-idx-${randomUUID()}`
    propertyId = randomUUID()
    portalId = randomUUID()
    groupId = randomUUID()
    const readingId = randomUUID()

    await lease.pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Metric index test', $3, 'UTC')`,
      [propertyId, organizationId, `metric-index-${propertyId}`],
    )
    await lease.pool.query(
      `INSERT INTO portals (id, organization_id, property_id, entity_id, name, slug)
       VALUES ($1, $2, $3, $3, 'Metric index portal', $4)`,
      [portalId, organizationId, propertyId, `metric-index-portal-${portalId}`],
    )
    await lease.pool.query(
      `INSERT INTO portal_groups (id, organization_id, property_id, name)
       VALUES ($1, $2, $3, 'Metric index group')`,
      [groupId, organizationId, propertyId],
    )
    await lease.pool.query(
      `INSERT INTO metric_readings (
         id, organization_id, property_id, portal_id, group_id, metric_key, value, recorded_at
       ) VALUES ($1, $2, $3, $4, $5, 'portal.review_link_click', 1, now())`,
      [readingId, organizationId, propertyId, portalId, groupId],
    )

    // Idempotent by name: leave no stale index from a previous failed run.
    for (const spec of [METRIC_PROPERTY_SPEC, METRIC_PORTAL_SPEC, METRIC_GROUP_SPEC]) {
      await lease.pool.query(`DROP INDEX CONCURRENTLY IF EXISTS "${spec.name}"`)
    }

    for (const spec of [METRIC_PROPERTY_SPEC, METRIC_PORTAL_SPEC, METRIC_GROUP_SPEC]) {
      await expect(buildConcurrentIndex(lease.pool, spec)).resolves.toEqual({
        name: spec.name,
        ok: true,
        code: 'created',
      })
      await expect(buildConcurrentIndex(lease.pool, spec)).resolves.toEqual({
        name: spec.name,
        ok: true,
        code: 'ready',
      })
    }

    // Catalogue shape: a Portal/Portal Group/Property delete's FK cascade
    // check is a bare `WHERE <column> = $1`, with no organization_id
    // predicate to use the org-prefixed indexes, so each FK column needs its
    // own valid, ready single-column index.
    const checks: readonly [
      column: 'property_id' | 'portal_id' | 'group_id',
      indexName: string,
    ][] = [
      ['property_id', METRIC_PROPERTY_SPEC.name],
      ['portal_id', METRIC_PORTAL_SPEC.name],
      ['group_id', METRIC_GROUP_SPEC.name],
    ]
    for (const [column, indexName] of checks) {
      const index = await readIndex(lease.pool, indexName)
      expect(index, column).toMatchObject({ indisvalid: true, indisready: true })
      expect(index?.indexdef, column).toContain(`(${column})`)
    }
  })
})
