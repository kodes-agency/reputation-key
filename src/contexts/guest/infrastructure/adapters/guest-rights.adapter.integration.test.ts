// Guest's rights executor against real PostgreSQL: one Organization with
// Properties A and B beside a second Organization. Each scope erases only what
// it names; everything else is compared as canonical JSON before and after.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  applyRestoreResurrectionFence,
  type BackupErasureReplayer,
} from '#/shared/db/lifecycle/backup-erasure-ledger'
import {
  decodeErasureJournalEntry,
  type ErasureJournalEntry,
} from '#/shared/db/lifecycle/erasure-journal.server'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { runRightsExecutors } from '#/shared/ops/rights/rights-executor'
import { createRightsJournal } from '#/shared/ops/rights/rights-journal'
import type { RightsJournalStore } from '#/shared/ops/rights/rights-journal'
import type { RightsRequestPlan } from '#/shared/ops/rights/rights-request-command'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  createGuestBackupErasureReplayer,
  createGuestPropertyErasureReplayer,
} from './guest-backup-erasure-replayer.adapter'
import { createGuestResponseErasureReplayer } from './guest-response-erasure-replayer.adapter'
import { createGuestRightsExecutor } from './guest-rights.adapter'
import { holdRightsOrganization } from '#/shared/db/testing/rights-isolation-fixture'

const AT = new Date('2026-08-01T00:00:00.000Z')
const OPERATOR = 'operator-guest-rights'
const RESTORE_POINT = new Date('2026-07-01T00:00:00.000Z')

/** Tables the executor can touch, parents last so a restore inserts in reverse. */
const TABLES = [
  'guest_response_private_feedback',
  'guest_response_session_bindings',
  'guest_responses',
  'guest_network_pressure_records',
  'scan_events',
  'idempotency_receipts',
] as const

type Seeded = Readonly<{
  organizationId: string
  propertyIds: readonly string[]
  /** The two responses of the first Property. */
  responseIds: readonly string[]
}>

const organizations = new Set<string>()
let lease: TestLease
let db: Database

const q = (text: string, params: unknown[] = []) => lease.pool.query(text, params)

async function seedProperty(organizationId: string, propertyId: string) {
  const portalId = randomUUID()
  const sessionId = randomUUID()
  const responseIds = [randomUUID(), randomUUID()]
  const scope = [organizationId, propertyId, portalId]
  await q(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1::uuid, $2, 'Rights Property', $4, 'UTC', $3, $3)`,
    [propertyId, organizationId, AT, `rights-${propertyId}`],
  )
  await q(
    `INSERT INTO portals (id, organization_id, property_id, entity_id, name, slug,
                          publication_state, created_at, updated_at)
     VALUES ($1::uuid, $2, $3::uuid, $3::uuid, 'Front Desk', $5, 'published', $4, $4)`,
    [portalId, organizationId, propertyId, AT, `portal-${portalId}`],
  )
  for (const responseId of responseIds) {
    await q(
      `INSERT INTO guest_responses (
         id, organization_id, property_id, portal_id, status, rating, response_consent,
         text_consent, private_feedback_threshold, correction_count,
         rating_source_event_id, feedback_source_event_id, submitted_at,
         feedback_submitted_at, feedback_submission_revision, retention_deadline,
         created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'submitted', 2, true, true, 3, 0, $5, $6, $7, $7, 1,
                 $7::timestamptz + interval '700 days', $7, $7)`,
      [responseId, ...scope, randomUUID(), randomUUID(), AT],
    )
    await q(
      `INSERT INTO guest_response_private_feedback (
         response_id, organization_id, property_id, portal_id, body, submitted_at,
         expires_at, created_at
       ) VALUES ($1, $2, $3, $4, 'fixture feedback', $5, $5::timestamptz + interval '88 days', $5)`,
      [responseId, ...scope, AT],
    )
    await q(
      `INSERT INTO guest_response_session_bindings (
         response_id, organization_id, property_id, portal_id, session_id, expires_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6::timestamptz + interval '1 day', $6)`,
      [responseId, ...scope, randomUUID(), AT],
    )
  }
  await q(
    `INSERT INTO guest_network_pressure_records (
       id, organization_id, property_id, portal_id, pseudonym, action, observed_at, expires_at
     ) VALUES ($1, $2, $3, $4, $5, 'rating', $6, $6::timestamptz + interval '7 days')`,
    [randomUUID(), ...scope, 'd'.repeat(64), AT],
  )
  await q(
    `INSERT INTO scan_events (id, organization_id, portal_id, property_id, source,
                              session_id, ip_hash, created_at)
     VALUES ($1, $2, $3, $4, 'qr', $5, 'fixture-hash', $6)`,
    [randomUUID(), organizationId, portalId, propertyId, sessionId, AT],
  )
  await q(
    `INSERT INTO idempotency_receipts (scope, key, payload, recorded_at)
     VALUES ('guest_destination_action', $1, jsonb_build_object(
       'organizationId', $2::text, 'propertyId', $3::text, 'portalId', $4::text), $5)`,
    [randomUUID(), ...scope, AT],
  )
  return responseIds
}

async function seedOrganization(): Promise<Seeded> {
  const organizationId = `guest-rights-${randomUUID()}`
  organizations.add(organizationId)
  await q(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Rights Fixture', $1, $2)`,
    [organizationId, AT],
  )
  const propertyIds = [randomUUID(), randomUUID()]
  const responseIds = await seedProperty(organizationId, propertyIds[0]!)
  await seedProperty(organizationId, propertyIds[1]!)
  return { organizationId, propertyIds, responseIds }
}

function rowsOf(table: string): string {
  return table === 'idempotency_receipts'
    ? `SELECT to_jsonb(t) AS r FROM idempotency_receipts t
       WHERE t.scope IN ('guest_qualified_scan', 'guest_destination_action')
         AND t.payload->>'organizationId' = $1
         AND ($2::text IS NULL OR t.payload->>'propertyId' = $2)`
    : `SELECT to_jsonb(t) AS r FROM ${table} t
       WHERE t.organization_id = $1 AND ($2::text IS NULL OR t.property_id::text = $2)`
}

/** Every Guest row of the Organization (or one Property), as canonical JSON. */
async function snapshot(organizationId: string, propertyId?: string): Promise<string> {
  const tables: Record<string, unknown> = {}
  for (const table of TABLES) {
    const result = await q(
      `SELECT coalesce(jsonb_agg(r ORDER BY r::text), '[]'::jsonb) AS rows FROM (${rowsOf(table)}) s`,
      [organizationId, propertyId ?? null],
    )
    tables[table] = result.rows[0]?.rows
  }
  return JSON.stringify(tables)
}

async function rowTotal(organizationId: string, propertyId?: string): Promise<number> {
  const tables = JSON.parse(await snapshot(organizationId, propertyId)) as Record<
    string,
    unknown[]
  >
  return Object.values(tables).reduce((sum, rows) => sum + rows.length, 0)
}

/** Puts back the rows a snapshot held, parents first. */
async function resurrect(before: string): Promise<void> {
  const tables = JSON.parse(before) as Record<string, Array<Record<string, unknown>>>
  for (const table of [...TABLES].reverse()) {
    const rows = tables[table] ?? []
    if (rows.length === 0) continue
    await q(
      `INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(null::${table}, $1::jsonb)
       ON CONFLICT DO NOTHING`,
      [JSON.stringify(rows)],
    )
  }
}

async function undelivered(organizationId: string): Promise<number> {
  const result = await q(
    `SELECT count(*)::int AS n FROM outbox_events
     WHERE organization_id = $1 AND published_at IS NULL`,
    [organizationId],
  )
  return result.rows[0]?.n
}

/** What the asynchronous consumers do: the facts are delivered and leave the queue. */
async function drainOutbox(organizationId: string): Promise<void> {
  await q('DELETE FROM outbox_events WHERE organization_id = $1', [organizationId])
  expect(await undelivered(organizationId)).toBe(0)
}

function plan(
  scope: RightsRequestPlan['scope'],
  seeded: Seeded,
  extra: Partial<RightsRequestPlan> = {},
): RightsRequestPlan {
  return {
    scope,
    mode: 'apply',
    organizationId: seeded.organizationId,
    batchSize: 50,
    receivedAt: AT,
    ...extra,
  }
}

function run(rightsPlan: RightsRequestPlan, store: RightsJournalStore) {
  const out: string[] = []
  const err: string[] = []
  return runRightsExecutors({
    plan: rightsPlan,
    executors: [
      createGuestRightsExecutor({
        db,
        now: () => AT,
        idGen: randomUUID,
        operator: { id: OPERATOR, authority: { verify: async (id) => id === OPERATOR } },
      }),
    ],
    journal: createRightsJournal(store),
    io: { out: (line) => out.push(line), err: (line) => err.push(line) },
    writeExportFile: async () => {},
  }).then((code) => ({ code, out, err }))
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

function replay(
  entries: readonly ErasureJournalEntry[],
  replayers: readonly BackupErasureReplayer[],
) {
  return db.transaction((tx) =>
    applyRestoreResurrectionFence(tx, {
      entries,
      restorePointAt: RESTORE_POINT,
      replayers,
    }),
  )
}

describe('guest rights executor', () => {
  beforeAll(async () => {
    registerAllEventSchemas()
    lease = await acquireTestLease(getEnv().DATABASE_URL, 3)
    db = drizzle(lease.pool) as Database
  })
  afterAll(async () => lease.release())
  afterEach(async () => {
    for (const organizationId of organizations) {
      for (const table of [...TABLES].filter((name) => name !== 'idempotency_receipts')) {
        await q(`DELETE FROM ${table} WHERE organization_id = $1`, [organizationId])
      }
      await q(`DELETE FROM idempotency_receipts WHERE payload->>'organizationId' = $1`, [
        organizationId,
      ])
      await q('DELETE FROM outbox_events WHERE organization_id = $1', [organizationId])
      await q('DELETE FROM portals WHERE organization_id = $1', [organizationId])
      await q('DELETE FROM properties WHERE organization_id = $1', [organizationId])
    }
    await deleteTestOrganizations(lease.pool, [...organizations])
    organizations.clear()
  })

  it('reports the rows of each scope without changing them', async () => {
    const first = await seedOrganization()
    const other = await seedOrganization()
    const before = await snapshot(first.organizationId)

    const property = await run(
      plan('property', first, { mode: 'report', propertyId: first.propertyIds[0] }),
      recordingStore().store,
    )
    const organization = await run(
      plan('organization', first, { mode: 'report' }),
      recordingStore().store,
    )

    expect(property.out).toEqual(
      expect.arrayContaining([
        'guest: guest_responses 2',
        'guest: scan_events 1',
        'guest: undelivered guest facts 0',
      ]),
    )
    // The purge counts responses, receipts, pressure records and the legacy visit mirror.
    expect(organization.out).toContain('guest: tenant rows 10')
    expect(await snapshot(first.organizationId)).toBe(before)
    expect(await rowTotal(other.organizationId)).toBe(18)
  })

  it('erases one response and leaves its sibling, Property B and the other Organization byte-identical', async () => {
    const first = await seedOrganization()
    const other = await seedOrganization()
    const [target, sibling] = first.responseIds as [string, string]
    const siblingBefore = await q(
      `SELECT to_jsonb(r) AS r FROM guest_responses r WHERE id = $1`,
      [sibling],
    )
    const propertyBBefore = await snapshot(first.organizationId, first.propertyIds[1])
    const otherBefore = await snapshot(other.organizationId)
    const { store, entries } = recordingStore()
    const request = plan('guest-response', first, {
      propertyId: first.propertyIds[0],
      responseId: target,
    })

    const result = await run(request, store)

    expect(result.err).toEqual([])
    expect(result.code).toBe(0)
    expect(result.out).toEqual(
      expect.arrayContaining([
        `guest: response ${target} erased`,
        expect.stringMatching(
          /^guest: undelivered guest facts [1-9]\d*; Inbox and Reporting/,
        ),
      ]),
    )
    const erased = await q(`SELECT status, rating FROM guest_responses WHERE id = $1`, [
      target,
    ])
    expect(erased.rows[0]).toMatchObject({ status: 'deleted', rating: null })
    expect(
      (await q(`SELECT to_jsonb(r) AS r FROM guest_responses r WHERE id = $1`, [sibling]))
        .rows,
    ).toEqual(siblingBefore.rows)
    expect(await snapshot(first.organizationId, first.propertyIds[1])).toBe(
      propertyBBefore,
    )
    expect(await snapshot(other.organizationId)).toBe(otherBefore)
    expect(await undelivered(first.organizationId)).toBeGreaterThan(0)
    expect(await undelivered(other.organizationId)).toBe(0)
    await drainOutbox(first.organizationId)

    // A restore brings the response back; the journaled entry erases it again.
    const journal = entries()
    expect(journal).toHaveLength(1)
    await q(
      `UPDATE guest_responses SET status = 'submitted', rating = 2, deleted_at = NULL,
         rating_source_event_id = $2, feedback_source_event_id = $3 WHERE id = $1`,
      [target, randomUUID(), randomUUID()],
    )
    const outcome = await replay(journal, [createGuestResponseErasureReplayer()])
    expect(outcome.verified).toBe(true)
    expect(outcome.counts.ledgerEntriesReapplied).toBe(1)
    expect(
      (await q(`SELECT status FROM guest_responses WHERE id = $1`, [target])).rows[0],
    ).toMatchObject({ status: 'deleted' })
    expect(await snapshot(other.organizationId)).toBe(otherBefore)
  })

  it('erases Property A including the legacy visit table and replays it after a restore', async () => {
    const first = await seedOrganization()
    const other = await seedOrganization()
    const [a, b] = first.propertyIds as [string, string]
    const aBefore = await snapshot(first.organizationId, a)
    const bBefore = await snapshot(first.organizationId, b)
    const otherBefore = await snapshot(other.organizationId)
    const { store, entries } = recordingStore()

    const result = await run(plan('property', first, { propertyId: a }), store)

    expect(result.code).toBe(0)
    expect(await rowTotal(first.organizationId, a)).toBe(0)
    expect(await snapshot(first.organizationId, b)).toBe(bBefore)
    expect(await snapshot(other.organizationId)).toBe(otherBefore)
    expect(await undelivered(first.organizationId)).toBe(0)

    await resurrect(aBefore)
    const resurrected = await rowTotal(first.organizationId, a)
    expect(resurrected).toBeGreaterThan(0)
    const outcome = await replay(entries(), [createGuestPropertyErasureReplayer()])

    expect(outcome.verified).toBe(true)
    expect(outcome.counts.ledgerRowsReErased).toBe(resurrected)
    expect(await rowTotal(first.organizationId, a)).toBe(0)
    expect(await snapshot(first.organizationId, b)).toBe(bBefore)
    expect(await snapshot(other.organizationId)).toBe(otherBefore)
  })

  it('purges the held Organization and leaves the other one byte-identical', async () => {
    const first = await seedOrganization()
    const other = await seedOrganization()
    holdRightsOrganization(first.organizationId)
    const firstBefore = await snapshot(first.organizationId)
    const otherBefore = await snapshot(other.organizationId)
    const { store, entries } = recordingStore()

    const result = await run(plan('organization', first), store)

    expect(result.code).toBe(0)
    expect(await rowTotal(first.organizationId)).toBe(0)
    expect(await snapshot(other.organizationId)).toBe(otherBefore)

    await resurrect(firstBefore)
    const resurrected = await rowTotal(first.organizationId)
    const outcome = await replay(entries(), [createGuestBackupErasureReplayer()])

    expect(outcome.verified).toBe(true)
    // The replayer counts the plan's roots, not the rows that hang off them.
    expect(resurrected).toBeGreaterThan(0)
    expect(outcome.counts.ledgerRowsReErased).toBe(10)
    expect(await rowTotal(first.organizationId)).toBe(0)
    expect(await snapshot(other.organizationId)).toBe(otherBefore)
  })

  it('erases nothing and raises the alert when the journal write rejects', async () => {
    const first = await seedOrganization()
    const other = await seedOrganization()
    const firstBefore = await snapshot(first.organizationId)
    const otherBefore = await snapshot(other.organizationId)
    const alert = vi.fn()

    const result = await run(
      plan('property', first, { propertyId: first.propertyIds[0] }),
      {
        put: async () => {
          throw new Error('bucket unavailable')
        },
        alert,
      },
    )

    expect(result.code).not.toBe(0)
    expect(alert).toHaveBeenCalledWith(expect.objectContaining({ context: 'guest' }))
    expect(await snapshot(first.organizationId)).toBe(firstBefore)
    expect(await snapshot(other.organizationId)).toBe(otherBefore)
  })

  describe('refusals before any write', () => {
    it('refuses an active Organization', async () => {
      const first = await seedOrganization()
      const before = await snapshot(first.organizationId)
      const put = vi.fn(async () => {})

      const result = await run(plan('organization', first), { put, alert: () => {} })

      expect(result.code).toBe(1)
      expect(result.err.join('\n')).toMatch(/still active; .*nothing was changed/)
      expect(put).not.toHaveBeenCalled()
      expect(await snapshot(first.organizationId)).toBe(before)
    })

    it('refuses a purge while Guest facts are undelivered', async () => {
      const first = await seedOrganization()
      holdRightsOrganization(first.organizationId)
      await q(
        `INSERT INTO outbox_events (id, event_type, event_version, payload, organization_id,
                                    source_context, source_aggregate_id, created_at)
         VALUES ($1, 'guest.rating.submitted', 1, '{}'::jsonb, $2, 'guest', $3, $4)`,
        [randomUUID(), first.organizationId, first.responseIds[0], AT],
      )
      const before = await snapshot(first.organizationId)

      const result = await run(plan('organization', first), recordingStore().store)

      expect(result.code).toBe(1)
      expect(result.err.join('\n')).toMatch(/not yet delivered.*nothing was changed/)
      expect(await snapshot(first.organizationId)).toBe(before)
    })

    it('refuses an operator that is not registered', async () => {
      const first = await seedOrganization()
      const before = await snapshot(first.organizationId)
      const out: string[] = []
      const err: string[] = []

      const code = await runRightsExecutors({
        plan: plan('guest-response', first, {
          propertyId: first.propertyIds[0],
          responseId: first.responseIds[0],
        }),
        executors: [
          createGuestRightsExecutor({
            db,
            now: () => AT,
            idGen: randomUUID,
            operator: { id: 'stranger', authority: { verify: async () => false } },
          }),
        ],
        journal: createRightsJournal(recordingStore().store),
        io: { out: (line) => out.push(line), err: (line) => err.push(line) },
        writeExportFile: async () => {},
      })

      expect(code).toBe(1)
      expect(err.join('\n')).toContain('operator_not_authorized')
      expect(await snapshot(first.organizationId)).toBe(before)
    })
  })
})
