// The manual rights path for Reporting records against real PostgreSQL, for
// two Organizations: an access export holds only the requested tenant's rows,
// the purge refuses an active Organization, and it removes only the requested
// tenant's rows while leaving the monthly-result guard enabled.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import type { RightsRequestPlan } from '#/shared/ops/rights/rights-request-command'
import {
  purgeRightsOrganization,
  writeRightsExport,
} from '#/shared/ops/rights/run-rights-executors'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { REPORTING_PURGE_ORDER } from './reporting-rights-plan'
import { createReportingRightsExecutor } from './reporting-rights.adapter'

const AT = new Date('2026-08-01T00:00:00.000Z')
const PROPERTY_REVIEW_DASHBOARD_VERSION = '11111111-1111-4111-8111-111111111205'

const organizations = new Set<string>()
let lease: TestLease
let db: Database

type Tenant = Readonly<{ organizationId: string; programId: string; readingId: string }>

async function seedTenant(): Promise<Tenant> {
  const organizationId = `rights-${randomUUID()}`
  organizations.add(organizationId)
  const tenant = { organizationId, programId: randomUUID(), readingId: randomUUID() }
  const propertyId = randomUUID()
  const q = (text: string, params: unknown[]) => lease.pool.query(text, params)
  await q(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Rights Fixture', $1, $2)`,
    [organizationId, AT],
  )
  await q(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1::uuid, $2, 'Rights Property', $1::text, 'UTC', $3, $3)`,
    [propertyId, organizationId, AT],
  )
  await q(
    `INSERT INTO goal_programs
       (id, organization_id, property_id, name, status, current_version, created_by, created_at, updated_at)
     VALUES ($1::uuid, $2, $3::uuid, 'Rights Program', 'paused', 1, 'user:test', $4, $4)`,
    [tenant.programId, organizationId, propertyId, AT],
  )
  await q(
    `INSERT INTO metric_readings (
       id, organization_id, property_id, metric_key, value, definition_version_id,
       source_event_id, source_policy, exact_value, sample_count, attribution_quality,
       recorded_at, event_at, property_local_date, data_quality, retention_class
     ) VALUES ($1::uuid, $2, $3::uuid, 'property.review', 5::real, $4, $5,
               'google_property_derivative', 5::numeric, 1, 'exact', $6, $6,
               '2026-08-01', 'exact', 'guest_gateway_metric')`,
    [
      tenant.readingId,
      organizationId,
      propertyId,
      PROPERTY_REVIEW_DASHBOARD_VERSION,
      `rights-${tenant.readingId}`,
      AT,
    ],
  )
  const rootId = randomUUID()
  const headId = randomUUID()
  await q(
    `INSERT INTO metric_corrections (id, reading_id, source_event_id, kind, reason, actor_type,
       actor_id, exact_delta, event_at, recorded_at)
     VALUES ($1::uuid, $2::uuid, $3, 'adjust', 'fixture', 'system', 'system:test', 1::numeric, $4, $4)`,
    [rootId, tenant.readingId, `root-${rootId}`, AT],
  )
  await q(
    `INSERT INTO metric_corrections (id, reading_id, source_event_id, kind, reason, actor_type,
       actor_id, replacement_value, supersedes_correction_id, event_at, recorded_at)
     VALUES ($1::uuid, $2::uuid, $3, 'replace', 'fixture', 'system', 'system:test', 4::numeric, $4::uuid, $5, $5)`,
    [headId, tenant.readingId, `head-${headId}`, rootId, AT],
  )
  await q(
    `INSERT INTO setup_checklist_milestones (organization_id, step, first_completed_at, created_at)
     VALUES ($1, 'published_portal', $2, $2)`,
    [organizationId, AT],
  )
  return tenant
}

async function hold(organizationId: string): Promise<void> {
  const lineage = randomUUID()
  await lease.pool.query(
    `UPDATE organization_lifecycle_authority
     SET state = 'closure_requested', revision = revision + 1,
         closure_lineage_id = $2, closure_requested_at = $3,
         recoverable_until = $4, reactivation_required = true,
         requested_by = 'admin:rights-test', request_reason_code = 'test_workspace',
         request_support_evidence_ref = 'test:closure-request',
         last_transition_at = $3, last_actor_id = 'admin:rights-test',
         last_reason_code = 'test_workspace', last_support_evidence_ref = 'test:closure-request'
     WHERE organization_id = $1`,
    [organizationId, lineage, AT, new Date('2026-08-31T00:00:00.000Z')],
  )
  for (const [next, reason] of [
    ['closing', 'closing_prepared'],
    ['purge_pending', 'recovery_window_elapsed'],
  ] as const) {
    await lease.pool.query(
      `UPDATE organization_lifecycle_authority
       SET state = $2, revision = revision + 1,
           last_transition_at = $3, last_actor_id = 'system:rights-test',
           last_reason_code = $4, last_support_evidence_ref = 'test:advance'
       WHERE organization_id = $1`,
      [organizationId, next, AT, reason],
    )
  }
}

async function counts(organizationId: string): Promise<Record<string, number>> {
  const result: Record<string, number> = {}
  for (const table of REPORTING_PURGE_ORDER) {
    const text =
      table === 'metric_corrections'
        ? `SELECT count(*)::int AS n FROM metric_corrections c
           JOIN metric_readings r ON r.id = c.reading_id WHERE r.organization_id = $1`
        : `SELECT count(*)::int AS n FROM ${table} WHERE organization_id = $1`
    result[table] = (
      (await lease.pool.query(text, [organizationId])).rows[0] as { n: number }
    ).n
  }
  return result
}

function plan(organizationId: string, outDir?: string): RightsRequestPlan {
  return {
    scope: 'organization',
    mode: 'apply',
    organizationId,
    batchSize: 50,
    ...(outDir ? { outDir } : {}),
  }
}

describe('reporting rights executor', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 3)
    db = drizzle(lease.pool) as Database
  })
  afterAll(async () => lease.release())
  afterEach(async () => {
    for (const organizationId of organizations) {
      await lease.pool.query(
        `DELETE FROM metric_corrections WHERE reading_id IN
           (SELECT id FROM metric_readings WHERE organization_id = $1)
           AND supersedes_correction_id IS NOT NULL`,
        [organizationId],
      )
      for (const table of REPORTING_PURGE_ORDER) {
        if (table === 'goal_monthly_results') continue
        await lease.pool.query(
          table === 'metric_corrections'
            ? `DELETE FROM metric_corrections WHERE reading_id IN
                 (SELECT id FROM metric_readings WHERE organization_id = $1)`
            : `DELETE FROM ${table} WHERE organization_id = $1`,
          [organizationId],
        )
      }
      await lease.pool.query('DELETE FROM properties WHERE organization_id = $1', [
        organizationId,
      ])
    }
    await deleteTestOrganizations(lease.pool, [...organizations])
    organizations.clear()
  })

  it('exports only the requested Organization', async () => {
    const a = await seedTenant()
    const b = await seedTenant()
    const written = new Map<string, string>()
    await writeRightsExport(
      [createReportingRightsExecutor(db)],
      plan(a.organizationId, '/out'),
      async (path, bytes) => {
        written.set(path, new TextDecoder().decode(bytes))
      },
    )
    const everything = [...written.values()].join('\n')
    expect(everything).toContain(a.programId)
    expect(everything).toContain(a.readingId)
    expect(everything).not.toContain(b.programId)
    expect(everything).not.toContain(b.readingId)
    expect(everything).not.toContain('source_event_id')
    expect(written.has(`/out/${a.organizationId}/reporting/manifest.json`)).toBe(true)
  })

  it('refuses to purge an active Organization and changes nothing', async () => {
    const a = await seedTenant()
    const before = await counts(a.organizationId)
    await expect(
      purgeRightsOrganization(
        [createReportingRightsExecutor(db)],
        plan(a.organizationId),
        AT,
      ),
    ).rejects.toThrow(/still active/)
    expect(await counts(a.organizationId)).toEqual(before)
  })

  it('purges one Organization, leaves the other untouched and the guard enabled', async () => {
    const a = await seedTenant()
    const b = await seedTenant()
    await hold(a.organizationId)
    const bBefore = await counts(b.organizationId)

    const lines = await purgeRightsOrganization(
      [createReportingRightsExecutor(db)],
      plan(a.organizationId),
      AT,
    )

    expect(lines[0]).toMatch(/^erasure record reporting org=.* reporting:purge:v1:/u)
    expect(Object.values(await counts(a.organizationId)).every((n) => n === 0)).toBe(true)
    expect(await counts(b.organizationId)).toEqual(bBefore)
    const guard = await lease.pool.query(
      `SELECT tgenabled FROM pg_trigger WHERE tgname = 'goal_monthly_results_guard'`,
    )
    expect(guard.rows[0]).toEqual({ tgenabled: 'O' })
  })
})
