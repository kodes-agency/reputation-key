// Real-Postgres coverage for the autocommit sidecar (database-03). Every
// query here runs WITHOUT an explicit transaction: `CREATE INDEX
// CONCURRENTLY` is refused inside one, so unlike most integration tests in
// this repo this file cannot isolate itself with BEGIN/ROLLBACK. Cleanup is
// explicit DELETE/DROP instead, mirroring the retired
// google-property-binding-index.integration.test.ts, which had the same
// constraint.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { buildConcurrentIndex } from './concurrent-index-sidecar'
import { CONCURRENT_INDEX_REGISTRY } from './concurrent-index-registry'

const SPEC = CONCURRENT_INDEX_REGISTRY.find(
  (candidate) =>
    candidate.name === 'review_provider_snapshot_runs_completed_property_idx',
)
if (!SPEC)
  throw new Error('review_provider_snapshot_runs_completed_property_idx not registered')

type PlanNode = Readonly<{
  'Node Type'?: string
  'Index Name'?: string
  'Relation Name'?: string
  Plans?: readonly PlanNode[]
}>

function flattenPlan(node: PlanNode): readonly PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(flattenPlan)]
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

    // Plan shape: property-setup.repository.ts's synced_properties CTE filters
    // on exactly this (organization_id, state = 'completed') predicate: it
    // must be served by an index, not a sequential scan of every
    // organization's rows.
    const plan = await lease.pool.query<{ 'QUERY PLAN': readonly [{ Plan: PlanNode }] }>(
      `EXPLAIN (FORMAT JSON) SELECT property_id FROM review_provider_snapshot_runs
        WHERE organization_id = $1 AND state = 'completed'`,
      [organizationId],
    )
    const nodes = flattenPlan(plan.rows[0]['QUERY PLAN'][0].Plan)
    expect(nodes.some((node) => node['Index Name'] === SPEC.name)).toBe(true)
    expect(
      nodes.some(
        (node) =>
          node['Node Type'] === 'Seq Scan' &&
          node['Relation Name'] === 'review_provider_snapshot_runs',
      ),
    ).toBe(false)
  })
})
