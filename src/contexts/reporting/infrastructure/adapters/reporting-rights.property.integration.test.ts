// The Reporting purge for a Property request against real PostgreSQL: one
// Organization with Property A and B beside a second Organization. Only A's
// rows may move; B, the Organization-level rows and the other Organization are
// compared as canonical JSON.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  applyRestoreResurrectionFence,
  type BackupErasureLedgerContext,
  type BackupErasureReplayer,
} from '#/shared/db/lifecycle/backup-erasure-ledger'
import { decodeErasureJournalEntry } from '#/shared/db/lifecycle/erasure-journal.server'
import { runRightsExecutors } from '#/shared/ops/rights/rights-executor'
import {
  createRightsJournal,
  type RightsJournalStore,
} from '#/shared/ops/rights/rights-journal'
import type { RightsRequestPlan } from '#/shared/ops/rights/rights-request-command'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  REPORTING_ORGANIZATION_ONLY_TABLES,
  REPORTING_PURGE_ORDER,
} from './reporting-rights-plan'
import {
  createReportingRightsExecutor,
  reportingPurgeInTransaction,
} from './reporting-rights.adapter'

const AT = new Date('2026-08-01T00:00:00.000Z')
const PROPERTY_REVIEW_DASHBOARD_VERSION = '11111111-1111-4111-8111-111111111205'
const JOURNAL_CONTEXTS: ReadonlyArray<BackupErasureLedgerContext> = [
  'goal',
  'metric',
  'dashboard',
]
const PROPERTY_TABLES = REPORTING_PURGE_ORDER.filter(
  (table) => !REPORTING_ORGANIZATION_ONLY_TABLES.includes(table),
)

type Seeded = Readonly<{ organizationId: string; propertyA: string; propertyB: string }>

const organizations = new Set<string>()
let lease: TestLease
let db: Database

const query = (text: string, params?: unknown[]) => lease.pool.query(text, params)

async function seedProperty(organizationId: string, propertyId: string): Promise<void> {
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
     ) VALUES ($1::uuid, $2, $3::uuid, 'property.review', 5::real, $4, $5,
               'google_property_derivative', 5::numeric, 1, 'exact', $6, $6,
               '2026-08-01', 'exact', 'guest_gateway_metric')`,
    [
      readingId,
      organizationId,
      propertyId,
      PROPERTY_REVIEW_DASHBOARD_VERSION,
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

async function seedTracked(): Promise<Seeded> {
  const seeded: Seeded = {
    organizationId: `rights-${randomUUID()}`,
    propertyA: randomUUID(),
    propertyB: randomUUID(),
  }
  organizations.add(seeded.organizationId)
  await query(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Rights Fixture', $1, $2)`,
    [seeded.organizationId, AT],
  )
  await seedProperty(seeded.organizationId, seeded.propertyA)
  await seedProperty(seeded.organizationId, seeded.propertyB)
  await query(
    `INSERT INTO setup_checklist_milestones (organization_id, step, first_completed_at, created_at)
     VALUES ($1, 'published_portal', $2, $2)`,
    [seeded.organizationId, AT],
  )
  return seeded
}

function propertyRows(table: string): string {
  return table === 'metric_corrections'
    ? `SELECT to_jsonb(t) AS r FROM metric_corrections t
       JOIN metric_readings m ON m.id = t.reading_id
       WHERE m.organization_id = $1 AND m.property_id = $2::uuid`
    : `SELECT to_jsonb(t) AS r FROM ${table} t
       WHERE t.organization_id = $1 AND t.property_id = $2::uuid`
}

/** One Property's rows in every purgeable table, as canonical JSON. */
async function propertySnapshot(organizationId: string, propertyId: string) {
  const tables: Record<string, unknown> = {}
  for (const table of PROPERTY_TABLES) {
    const result = await query(
      `SELECT coalesce(jsonb_agg(r ORDER BY r::text), '[]'::jsonb) AS rows
       FROM (${propertyRows(table)}) s`,
      [organizationId, propertyId],
    )
    tables[table] = result.rows[0]?.rows
  }
  return JSON.stringify(tables)
}

/** Everything the Organization holds outside any one Property's purgeable rows. */
async function organizationLevel(organizationId: string): Promise<string> {
  const milestones = await query(
    `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) AS rows
     FROM setup_checklist_milestones t WHERE organization_id = $1`,
    [organizationId],
  )
  const properties = await query(
    `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) AS rows
     FROM properties t WHERE organization_id = $1`,
    [organizationId],
  )
  return JSON.stringify([milestones.rows[0]?.rows, properties.rows[0]?.rows])
}

async function whole(seeded: Seeded): Promise<string> {
  return [
    await propertySnapshot(seeded.organizationId, seeded.propertyA),
    await propertySnapshot(seeded.organizationId, seeded.propertyB),
    await organizationLevel(seeded.organizationId),
  ].join('\n')
}

async function counts(organizationId: string, propertyId: string) {
  const held: Record<string, number> = {}
  for (const table of PROPERTY_TABLES) {
    const result = await query(
      `SELECT count(*)::int AS n FROM (${propertyRows(table)}) s`,
      [organizationId, propertyId],
    )
    held[table] = result.rows[0]?.n ?? -1
  }
  return held
}

const total = (held: Record<string, number>) =>
  Object.values(held).reduce((sum, n) => sum + n, 0)

/** Puts back the rows a snapshot held, roots of a supersession chain first. */
async function resurrect(snapshot: string): Promise<void> {
  const tables = JSON.parse(snapshot) as Record<string, Array<Record<string, unknown>>>
  for (const table of [...PROPERTY_TABLES].reverse()) {
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
}

function plan(
  seeded: Seeded,
  mode: RightsRequestPlan['mode'],
  propertyId: string = seeded.propertyA,
): RightsRequestPlan {
  return {
    scope: 'property',
    mode,
    organizationId: seeded.organizationId,
    propertyId,
    batchSize: 50,
    receivedAt: AT,
  }
}

async function run(rightsPlan: RightsRequestPlan, store: RightsJournalStore) {
  const out: string[] = []
  const err: string[] = []
  const code = await runRightsExecutors({
    plan: rightsPlan,
    executors: [createReportingRightsExecutor(db, () => AT)],
    journal: createRightsJournal(store),
    io: { out: (line) => out.push(line), err: (line) => err.push(line) },
    writeExportFile: async () => {},
  })
  return { code, out, err }
}

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

function propertyReplayer(context: BackupErasureLedgerContext): BackupErasureReplayer {
  return {
    context,
    subjectClass: 'property',
    async reErase(tx, entry) {
      const outcome = await reportingPurgeInTransaction(
        tx,
        entry.organizationId,
        AT,
        entry.propertyId,
      )
      return Object.values(outcome.deleted).reduce((sum, n) => sum + n, 0)
    },
  }
}

describe('reporting rights for a Property request', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 3)
    db = drizzle(lease.pool) as Database
  })
  afterAll(async () => lease.release())
  afterEach(async () => {
    for (const organizationId of organizations) {
      await query(
        `DELETE FROM metric_corrections WHERE reading_id IN
           (SELECT id FROM metric_readings WHERE organization_id = $1)
           AND supersedes_correction_id IS NOT NULL`,
        [organizationId],
      )
      for (const table of REPORTING_PURGE_ORDER) {
        await query(
          table === 'metric_corrections'
            ? `DELETE FROM metric_corrections WHERE reading_id IN
                 (SELECT id FROM metric_readings WHERE organization_id = $1)`
            : `DELETE FROM ${table} WHERE organization_id = $1`,
          [organizationId],
        )
      }
      await query('DELETE FROM properties WHERE organization_id = $1', [organizationId])
    }
    await deleteTestOrganizations(lease.pool, [...organizations])
    organizations.clear()
  })

  it('reports the rows of one Property without the Organization-level rows', async () => {
    const asked = await seedTracked()
    const before = await whole(asked)

    const result = await run(plan(asked, 'report'), recordingStore().store)

    expect(result.code).toBe(0)
    expect(result.out).toEqual(
      expect.arrayContaining([
        'reporting: goal_programs 1',
        'reporting: metric_readings 1',
        'reporting: metric_corrections 2',
      ]),
    )
    expect(result.out.join('\n')).not.toContain('setup_checklist_milestones')
    expect(await whole(asked)).toBe(before)
  })

  it('purges A and leaves B, the Organization-level rows and the other Organization byte-identical', async () => {
    const asked = await seedTracked()
    const other = await seedTracked()
    const bBefore = await propertySnapshot(asked.organizationId, asked.propertyB)
    const levelBefore = await organizationLevel(asked.organizationId)
    const otherBefore = await whole(other)
    const { store, entries } = recordingStore()

    const result = await run(plan(asked, 'apply'), store)

    expect(result.code).toBe(0)
    expect(entries().map((entry) => entry.context)).toEqual(JOURNAL_CONTEXTS)
    expect(total(await counts(asked.organizationId, asked.propertyA))).toBe(0)
    expect(await propertySnapshot(asked.organizationId, asked.propertyB)).toBe(bBefore)
    expect(await organizationLevel(asked.organizationId)).toBe(levelBefore)
    expect(await whole(other)).toBe(otherBefore)
  })

  it('removes resurrected rows of A again when the journal is replayed after a restore', async () => {
    const asked = await seedTracked()
    const other = await seedTracked()
    const aBefore = await propertySnapshot(asked.organizationId, asked.propertyA)
    const bBefore = await propertySnapshot(asked.organizationId, asked.propertyB)
    const otherBefore = await whole(other)
    const { store, entries } = recordingStore()
    expect((await run(plan(asked, 'apply'), store)).code).toBe(0)

    await resurrect(aBefore)
    expect(await propertySnapshot(asked.organizationId, asked.propertyA)).toBe(aBefore)
    const resurrected = total(await counts(asked.organizationId, asked.propertyA))
    expect(resurrected).toBeGreaterThan(0)
    const journal = entries()
    expect(journal).toHaveLength(JOURNAL_CONTEXTS.length)
    expect(
      journal.every(
        (entry) =>
          entry.subjectClass === 'property' && entry.propertyId === asked.propertyA,
      ),
    ).toBe(true)

    const replay = await db.transaction((tx) =>
      applyRestoreResurrectionFence(tx, {
        entries: journal,
        restorePointAt: new Date('2026-07-01T00:00:00.000Z'),
        replayers: JOURNAL_CONTEXTS.map(propertyReplayer),
      }),
    )

    expect(replay.verified).toBe(true)
    expect(replay.counts.ledgerEntriesReapplied).toBe(JOURNAL_CONTEXTS.length)
    expect(total(await counts(asked.organizationId, asked.propertyA))).toBe(0)
    expect(await propertySnapshot(asked.organizationId, asked.propertyB)).toBe(bBefore)
    expect(await whole(other)).toBe(otherBefore)
  })

  it('erases nothing and raises the alert when the journal write rejects', async () => {
    const asked = await seedTracked()
    const other = await seedTracked()
    const before = [await whole(asked), await whole(other)]
    const alert = vi.fn()

    const result = await run(plan(asked, 'apply'), {
      put: async () => {
        throw new Error('bucket unavailable')
      },
      alert,
    })

    expect(result.code).not.toBe(0)
    expect(alert).toHaveBeenCalledWith(expect.objectContaining({ context: 'goal' }))
    expect([await whole(asked), await whole(other)]).toEqual(before)
  })

  it('refuses a Property that belongs to another Organization and changes nothing', async () => {
    const asked = await seedTracked()
    const other = await seedTracked()
    const put = vi.fn(async () => {})
    const before = [await whole(asked), await whole(other)]

    const result = await run(plan(asked, 'apply', other.propertyA), {
      put,
      alert: () => {},
    })

    expect(result.code).toBe(1)
    expect(result.err.join('\n')).toContain('Property not found')
    expect(put).not.toHaveBeenCalled()
    expect([await whole(asked), await whole(other)]).toEqual(before)
  })
})
