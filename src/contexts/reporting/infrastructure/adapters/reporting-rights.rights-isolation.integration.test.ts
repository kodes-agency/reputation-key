// The Reporting purge against real PostgreSQL for one Organization with two
// Properties (A and B) beside a second Organization. The purge is
// Organization-scoped, so it removes A and B together; the second Organization
// is the witness that nothing else moves. Rows are compared as canonical JSON.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  applyRestoreResurrectionFence,
  type BackupErasureLedgerContext,
} from '#/shared/db/lifecycle/backup-erasure-ledger'
import {
  decodeErasureJournalEntry,
  type ErasureJournalEntry,
} from '#/shared/db/lifecycle/erasure-journal.server'
import { holdTransaction } from '#/shared/db/testing/held-transaction'
import { runRightsExecutors } from '#/shared/ops/rights/rights-executor'
import { createRightsJournal } from '#/shared/ops/rights/rights-journal'
import type { RightsJournalStore } from '#/shared/ops/rights/rights-journal'
import type { RightsRequestPlan } from '#/shared/ops/rights/rights-request-command'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { seedGoalMonth } from '../testing/goal-running-month-seed'
import { REPORTING_PURGE_ORDER } from './reporting-rights-plan'
import {
  createReportingRightsExecutor,
  createReportingRightsReplayers,
} from './reporting-rights.adapter'

const AT = new Date('2026-08-01T00:00:00.000Z')
const PORTAL_RATING_VERSION = '11111111-1111-4111-8111-111111111202'
const JOURNAL_CONTEXTS: ReadonlyArray<BackupErasureLedgerContext> = [
  'goal',
  'metric',
  'dashboard',
]

type QueryRow = { n: number; rows: unknown; status: string }
type Query = (text: string, params?: unknown[]) => Promise<{ rows: QueryRow[] }>
type Seeded = Readonly<{ organizationId: string; propertyIds: readonly string[] }>

const organizations = new Set<string>()
let lease: TestLease
let db: Database
let poolQuery: Query

async function seedOrganization(query: Query, properties: number): Promise<Seeded> {
  const organizationId = `rights-${randomUUID()}`
  const propertyIds: string[] = []
  await query(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Rights Fixture', $1, $2)`,
    [organizationId, AT],
  )
  for (let index = 0; index < properties; index += 1) {
    const propertyId = randomUUID()
    propertyIds.push(propertyId)
    await seedProperty(query, organizationId, propertyId)
  }
  return { organizationId, propertyIds }
}

async function seedProperty(
  query: Query,
  organizationId: string,
  propertyId: string,
): Promise<void> {
  const readingId = randomUUID()
  const rootId = randomUUID()
  const headId = randomUUID()
  await query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1::uuid, $2, 'Rights Property', $1::text, 'UTC', $3, $3)`,
    [propertyId, organizationId, AT],
  )
  await query(
    `INSERT INTO goal_programs
       (id, organization_id, property_id, name, status, current_version, created_by, created_at, updated_at)
     VALUES ($1::uuid, $2, $3::uuid, 'Rights Program', 'paused', 1, 'user:test', $4, $4)`,
    [randomUUID(), organizationId, propertyId, AT],
  )
  await query(
    `INSERT INTO metric_readings (
       id, organization_id, property_id, metric_key, value, definition_version_id,
       source_event_id, source_policy, exact_value, sample_count, attribution_quality,
       recorded_at, event_at, property_local_date, data_quality, retention_class
     ) VALUES ($1::uuid, $2, $3::uuid, 'portal.rating', 5::real, $4, $5,
               'first_party_guest_private', 5::numeric, 1, 'exact', $6, $6,
               '2026-08-01', 'exact', 'guest_gateway_metric')`,
    [
      readingId,
      organizationId,
      propertyId,
      PORTAL_RATING_VERSION,
      `rights-${readingId}`,
      AT,
    ],
  )
  await query(
    `INSERT INTO metric_corrections (id, reading_id, source_event_id, kind, reason, actor_type,
       actor_id, exact_delta, event_at, recorded_at)
     VALUES ($1::uuid, $2::uuid, $3, 'adjust', 'fixture', 'system', 'system:test', 1::numeric, $4, $4)`,
    [rootId, readingId, `root-${rootId}`, AT],
  )
  await query(
    `INSERT INTO metric_corrections (id, reading_id, source_event_id, kind, reason, actor_type,
       actor_id, replacement_value, supersedes_correction_id, event_at, recorded_at)
     VALUES ($1::uuid, $2::uuid, $3, 'replace', 'fixture', 'system', 'system:test', 4::numeric, $4::uuid, $5, $5)`,
    [headId, readingId, `head-${headId}`, rootId, AT],
  )
}

async function hold(query: Query, organizationId: string): Promise<void> {
  const lineage = randomUUID()
  await query(
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
    await query(
      `UPDATE organization_lifecycle_authority
       SET state = $2, revision = revision + 1,
           last_transition_at = $3, last_actor_id = 'system:rights-test',
           last_reason_code = $4, last_support_evidence_ref = 'test:advance'
       WHERE organization_id = $1`,
      [organizationId, next, AT, reason],
    )
  }
}

function tenantRows(table: string): string {
  return table === 'metric_corrections'
    ? `SELECT to_jsonb(t) AS r FROM metric_corrections t
       JOIN metric_readings m ON m.id = t.reading_id WHERE m.organization_id = $1`
    : `SELECT to_jsonb(t) AS r FROM ${table} t WHERE t.organization_id = $1`
}

/** Every purgeable row of the Organization plus its Properties, as canonical JSON. */
async function snapshot(query: Query, organizationId: string): Promise<string> {
  const tables: Record<string, unknown> = {}
  for (const table of [...REPORTING_PURGE_ORDER, 'properties']) {
    const result = await query(
      `SELECT coalesce(jsonb_agg(r ORDER BY r::text), '[]'::jsonb) AS rows
       FROM (${tenantRows(table)}) s`,
      [organizationId],
    )
    tables[table] = result.rows[0]?.rows
  }
  return JSON.stringify(tables)
}

async function rowCounts(
  query: Query,
  organizationId: string,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const table of REPORTING_PURGE_ORDER) {
    const result = await query(
      `SELECT count(*)::int AS n FROM (${tenantRows(table)}) s`,
      [organizationId],
    )
    counts[table] = result.rows[0]?.n ?? -1
  }
  return counts
}

function totalRows(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0)
}

/** Puts back the rows a snapshot held, roots of a supersession chain first. */
async function resurrect(query: Query, organizationId: string, before: string) {
  const tables = JSON.parse(before) as Record<string, Array<Record<string, unknown>>>
  for (const table of [...REPORTING_PURGE_ORDER].reverse()) {
    const rows = tables[table] ?? []
    const isTip = (row: Record<string, unknown>) =>
      Object.entries(row).some(([key, value]) => key.startsWith('supersedes_') && value)
    for (const batch of [rows.filter((row) => !isTip(row)), rows.filter(isTip)]) {
      if (batch.length === 0) continue
      await query(
        `INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(null::${table}, $1::jsonb)`,
        [JSON.stringify(batch)],
      )
    }
  }
  expect(await snapshot(query, organizationId)).toBe(before)
}

function plan(
  organizationId: string,
  mode: RightsRequestPlan['mode'] = 'apply',
): RightsRequestPlan {
  return { scope: 'organization', mode, organizationId, batchSize: 50, receivedAt: AT }
}

function run(
  rightsPlan: RightsRequestPlan,
  store: RightsJournalStore,
  executorDb: Database = db,
) {
  const out: string[] = []
  const err: string[] = []
  return runRightsExecutors({
    plan: rightsPlan,
    executors: [createReportingRightsExecutor(executorDb, () => AT)],
    journal: createRightsJournal(store),
    io: { out: (line) => out.push(line), err: (line) => err.push(line) },
    writeExportFile: async () => {},
  }).then((code) => ({ code, out, err }))
}

/** A journal store that remembers what the runner wrote before it erased. */
function recordingStore() {
  const written = new Map<string, string>()
  const store: RightsJournalStore = {
    put: async (key, bytes) => {
      written.set(key, bytes)
    },
    alert: () => {},
  }
  return { store, entries: () => [...written.values()].map(decodeErasureJournalEntry) }
}

async function seedTracked(properties: number): Promise<Seeded> {
  const seeded = await seedOrganization(poolQuery, properties)
  organizations.add(seeded.organizationId)
  return seeded
}

describe('reporting rights isolation', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 3)
    db = drizzle(lease.pool) as Database
    poolQuery = (text, params) => lease.pool.query(text, params)
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

  it('reports the rows of each Organization separately', async () => {
    const first = await seedTracked(2)
    const other = await seedTracked(1)
    const lines = async (organizationId: string) =>
      (await run(plan(organizationId, 'report'), recordingStore().store)).out

    expect(await lines(first.organizationId)).toEqual(
      expect.arrayContaining([
        'reporting: goal_programs 2',
        'reporting: metric_readings 2',
        'reporting: metric_corrections 4',
      ]),
    )
    expect(await lines(other.organizationId)).toEqual(
      expect.arrayContaining([
        'reporting: goal_programs 1',
        'reporting: metric_readings 1',
        'reporting: metric_corrections 2',
      ]),
    )
  })

  it('purges Properties A and B together and leaves the other Organization byte-identical', async () => {
    const first = await seedTracked(2)
    const other = await seedTracked(1)
    await hold(poolQuery, first.organizationId)
    const propertiesBefore = (await snapshot(poolQuery, first.organizationId)).split(
      '"properties":',
    )[1]
    const otherBefore = await snapshot(poolQuery, other.organizationId)
    const { store, entries } = recordingStore()

    const result = await run(plan(first.organizationId), store)

    expect(result.code).toBe(0)
    expect(entries().map((entry) => entry.context)).toEqual(JOURNAL_CONTEXTS)
    expect(totalRows(await rowCounts(poolQuery, first.organizationId))).toBe(0)
    expect(
      (await snapshot(poolQuery, first.organizationId)).split('"properties":')[1],
    ).toBe(propertiesBefore)
    expect(await snapshot(poolQuery, other.organizationId)).toBe(otherBefore)
  })

  it('removes resurrected rows again when the journal is replayed after a restore', async () => {
    const first = await seedTracked(2)
    const other = await seedTracked(1)
    await hold(poolQuery, first.organizationId)
    const firstBefore = await snapshot(poolQuery, first.organizationId)
    const otherBefore = await snapshot(poolQuery, other.organizationId)
    const { store, entries } = recordingStore()
    expect((await run(plan(first.organizationId), store)).code).toBe(0)
    expect(totalRows(await rowCounts(poolQuery, first.organizationId))).toBe(0)

    await resurrect(poolQuery, first.organizationId, firstBefore)
    const resurrected = totalRows(await rowCounts(poolQuery, first.organizationId))
    expect(resurrected).toBeGreaterThan(0)
    const journal: ErasureJournalEntry[] = [...entries()]
    expect(journal).toHaveLength(JOURNAL_CONTEXTS.length)

    const replay = await db.transaction((tx) =>
      applyRestoreResurrectionFence(tx, {
        entries: journal,
        restorePointAt: new Date('2026-07-01T00:00:00.000Z'),
        replayers: createReportingRightsReplayers(() => AT),
      }),
    )

    expect(replay.verified).toBe(true)
    expect(replay.counts.ledgerEntriesReapplied).toBe(JOURNAL_CONTEXTS.length)
    expect(replay.counts.ledgerRowsReErased).toBe(resurrected)
    expect(totalRows(await rowCounts(poolQuery, first.organizationId))).toBe(0)
    expect(await snapshot(poolQuery, other.organizationId)).toBe(otherBefore)
  })

  it('erases nothing and raises the alert when the journal write rejects', async () => {
    const first = await seedTracked(2)
    const other = await seedTracked(1)
    await hold(poolQuery, first.organizationId)
    const firstBefore = await snapshot(poolQuery, first.organizationId)
    const otherBefore = await snapshot(poolQuery, other.organizationId)
    const alert = vi.fn()

    const result = await run(plan(first.organizationId), {
      put: async () => {
        throw new Error('bucket unavailable')
      },
      alert,
    })

    expect(result.code).not.toBe(0)
    expect(alert).toHaveBeenCalledWith(expect.objectContaining({ context: 'goal' }))
    expect(await snapshot(poolQuery, first.organizationId)).toBe(firstBefore)
    expect(await snapshot(poolQuery, other.organizationId)).toBe(otherBefore)
  })

  describe('refusals before any write', () => {
    it('refuses an active Organization and leaves its rows unchanged', async () => {
      const first = await seedTracked(2)
      const before = await snapshot(poolQuery, first.organizationId)
      const put = vi.fn(async () => {})

      const result = await run(plan(first.organizationId), { put, alert: () => {} })

      expect(result.code).toBe(1)
      expect(result.err.join('\n')).toMatch(/still active; .*nothing was changed/)
      expect(put).not.toHaveBeenCalled()
      expect(await snapshot(poolQuery, first.organizationId)).toBe(before)
    })

    it('refuses a reconciling result and keeps every goal program active', async () => {
      const fixture = await holdTransaction()
      try {
        const query: Query = (text, params) => fixture.client.query(text, params)
        const { organizationId, propertyIds } = await seedOrganization(query, 1)
        await seedGoalMonth(fixture.client, {
          organizationId,
          propertyId: propertyIds[0]!,
          target: 10,
          programStatus: 'active',
          monthStatus: 'reconciling',
        })
        await hold(query, organizationId)
        const before = await snapshot(query, organizationId)
        const statuses = () =>
          query(
            `SELECT status FROM goal_programs WHERE organization_id = $1 ORDER BY id`,
            [organizationId],
          ).then((result) => result.rows.map((row) => row.status))
        expect(await statuses()).toContain('active')

        const outcome = await createReportingRightsExecutor(fixture.db, () => AT)
          .preflight!(plan(organizationId))

        expect(outcome).toEqual({
          ok: false,
          error: 'a goal is still being evaluated; try again after it settles',
        })
        expect(await statuses()).toContain('active')
        expect(await snapshot(query, organizationId)).toBe(before)
      } finally {
        await fixture.rollBack()
      }
    })

    it('passes a held Organization with an active program without pausing it', async () => {
      const fixture = await holdTransaction()
      try {
        const query: Query = (text, params) => fixture.client.query(text, params)
        const { organizationId, propertyIds } = await seedOrganization(query, 1)
        await seedGoalMonth(fixture.client, {
          organizationId,
          propertyId: propertyIds[0]!,
          target: 10,
          programStatus: 'active',
          monthStatus: 'open',
        })
        await hold(query, organizationId)
        const before = await snapshot(query, organizationId)

        const outcome = await createReportingRightsExecutor(fixture.db, () => AT)
          .preflight!(plan(organizationId))

        expect(outcome).toEqual({ ok: true })
        expect(await snapshot(query, organizationId)).toBe(before)
        const active = await query(
          `SELECT count(*)::int AS n FROM goal_programs
           WHERE organization_id = $1 AND status = 'active'`,
          [organizationId],
        )
        expect(active.rows[0]?.n).toBe(1)
      } finally {
        await fixture.rollBack()
      }
    })
  })
})
